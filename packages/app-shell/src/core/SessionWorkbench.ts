import { formatDefaultFileTitle, t, type SessionSkillControls } from '@itookit/common';
import { showMountDialog } from '../files/mount-dialog';
import { localizeMountError } from '../files/localize-mount-error';

import type { EditorFactory, IEditor, EditorHostContext, ContextMenuConfig } from '@itookit/ui-common';
import type { ISessionRepository } from '@itookit/llm-session';
import type { Kernel } from '@itookit/durable-kernel';
import { createVFSUI, type VFSUIShell, type VFSNodeUI } from '@itookit/vfs-ui';
import { createFileSystemView, type IFileSystem, type FileSystemContextOwner, type FileSystemView, type FileSystemSourceOwner } from '@itookit/vfs-core';



import { taskStat } from '@itookit/durable-kernel';
import { createSessionBrowser, exportSessionBundle, parseSessionRoute, resolveBrowserTarget, sessionRoute, taskSummary, taskKeyEvent,
    SessionLifecycleService, type DirectoryMountService, type SessionFilesService, type WorkspaceController } from '@itookit/app-core';

/** Sidebar refresh tracing — enable with localStorage['vfs:debug']='1' (same flag as vfs-ui). */
function debugEnabled(): boolean {
    try { return typeof localStorage !== 'undefined' && localStorage.getItem('vfs:debug') === '1'; } catch { return false; }
}

/** Keep Session order independent of mutable titles, timestamps and persisted UI sorting. */
function compareSessionEntries(a: VFSNodeUI, b: VFSNodeUI): number | undefined {
    const isSession = (item: VFSNodeUI) => !isFlowPath(item.id) && resolveBrowserTarget(item.id).kind === 'session';
    const aSession = isSession(a), bSession = isSession(b);
    // Keep folder/Flow navigation together so mixed siblings have a transitive order.
    if (aSession !== bSession) return aSession ? 1 : -1;
    if (!aSession) return undefined;
    return Date.parse(b.metadata.createdAt) - Date.parse(a.metadata.createdAt) || a.id.localeCompare(b.id);
}

/** vfs-ui owns the sidebar; this host owns business views and their file leases. */
export class SessionWorkbench implements WorkspaceController {
    private readonly dialogs = new AbortController();
    private editor?: IEditor;
    private previewCleanup?: () => void;
    private context?: FileSystemContextOwner;
    private assets?: FileSystemView;
    private browser?: FileSystemSourceOwner;
    private navigationFiles?: FileSystemView;
    private sidebarUI?: VFSUIShell;
    private lifecycle!: SessionLifecycleService;
    private active: string | null = null;
    private activeBranch?: string;
    private selectionSync?: string;
    private closed = false;
    private tail: Promise<void> = Promise.resolve();
    private refreshTail: Promise<void> = Promise.resolve();
    private unsubscribers: Array<() => void> = [];
    private taskRefresh = 0;
    private refreshQueued = false;
    private refreshTimer?: ReturnType<typeof setTimeout>;
    private readonly refreshSources = new Set<string>();
    private kernelChanges: Record<string, number> = {};
    private refreshCount = 0;
    private lastRefreshAt = 0;
    private readonly waiting = new Set<string>();
    private readonly resettingTasks = new Set<string>();
    /** File whose editor is open, for the L4 glob mount/unmount pair. */
    private openEditorTarget?: { sessionId: string; path: string };
    constructor(private readonly sidebar: HTMLElement, private readonly container: HTMLElement,
        private readonly repository: ISessionRepository, private readonly files: SessionFilesService,
        private readonly factory: EditorFactory, private readonly onSelect: (id: string, mode?: 'push' | 'replace') => void,
        private readonly hostContext: EditorHostContext | undefined, private readonly kernel: Kernel,
        private readonly fileFactory: EditorFactory, private readonly directoryMounts?: DirectoryMountService,
        private readonly sessionSkills?: SessionSkillControls,
        private readonly manageMemory?: (sessionId: string, signal: AbortSignal) => Promise<void>,
        private readonly flows?: { fs: IFileSystem; menu: ContextMenuConfig<VFSNodeUI> }) {}
    async start(): Promise<void> {
        this.browser = await createSessionBrowser({ repository: this.repository, files: this.files, kernel: this.kernel });
        this.navigationFiles = createFileSystemView({ viewId: 'session-navigation:admin', mounts: [
            { mountId: 'sessions', at: '/', fs: this.browser.fs, access: 'rw' },
            ...(this.flows ? [{ mountId: 'flows', at: '/@flows', fs: this.flows.fs, access: 'rw' as const }] : []),
        ] });
        this.lifecycle = new SessionLifecycleService({ repository: this.repository, kernel: this.kernel });
        this.sidebarUI = createVFSUI({ sessionListContainer: this.sidebar, title: '会话', scopeId: 'session-browser:v1:admin',
            readOnly: false, activateDirectories: true, defaultUiSettings: { sortBy: 'lastModified' },
            compareItems: compareSessionEntries,
            restoreExpandedDirectory: path => isFlowPath(path) || resolveBrowserTarget(path).kind === 'folder',
            exportDirectories: true,
            exportItem: item => this.exportSessionItem(item),
            fileCreation: { label: '会话', title: formatDefaultFileTitle(), resolveParent: sessionCreationParent },
            contextMenu: {
                items: (item, defaults) => {
                    if (isFlowPath(item.id)) return this.flows?.menu.items?.(item,
                        item.id === '/@flows' ? [] : defaults.filter(entry => 'id' in entry && entry.id === 'delete')) ?? [];
                    const target = resolveBrowserTarget(item.id);
                    if (target.kind === 'task') {
                        return [{ id: 'reset-task', label: '强制复位任务（停止执行，保留记录）',
                            onClick: () => { void this.resetTask(item.id).catch(error => this.report(error)); } }];
                    }
                    // Closing stops the run but keeps the Session history, so it is offered
                    // next to (not instead of) the destructive delete.
                    if (target.kind === 'session') {
                        return [...defaults, { id: 'rerun-session', label: t('session.rerun.title'),
                            onClick: () => { void this.rerunSession(target.sessionId).catch(error => this.report(error)); } }, { id: 'close-session', label: t('session.close.action'),
                            onClick: () => { void this.closeSession(target.sessionId).catch(error => this.report(error)); } }];
                    }
                    return defaults;
                },
            },
        }, this.navigationFiles) as VFSUIShell;
        this.unsubscribers.push(this.sidebarUI.on('sessionSelected', ({ item }) => {
            // Expanding ancestors during selectPath can emit intermediate selections too.
            if (item && !this.selectionSync) void this.openResource(item.id).catch(error => this.report(error));
        }), this.sidebarUI.on('sidebarStateChanged', ({ isCollapsed }) => this.sidebar.classList.toggle('is-collapsed', isCollapsed)),
        this.repository.subscribe(change => { if (change?.kind !== 'ui-state') this.scheduleRefresh('repository'); }),
        this.files.subscribe(() => this.scheduleRefresh('files')),
        // Task content (stream deltas, logs, shared state) notifies many times per
        // second while a run streams. The sidebar only lists Sessions and Tasks, so
        // re-render on structural changes only — never per output chunk.
        this.kernel.onChanged(event => {
            this.noteKernelChange(event.reason);
            if (event.reason !== 'content') this.scheduleRefresh('kernel:' + event.reason);
        }));
        await this.sidebarUI.start();
        if (!this.active) this.message('选择一个会话，或新建会话');
    }
    /**
     * Stop a running Session and keep every record. Deletion is a separate action; this
     * only cancels the in-flight run and waits until the external stop is confirmed.
     */
    private async rerunSession(sessionId: string): Promise<void> {
        await this.openResource(sessionId);
        if (this.closed || this.active !== sessionId) return;
        const rerun = this.editor?.commands?.rerunSession;
        if (!rerun) throw new Error(t('session.rerun.unavailable'));
        await rerun();
    }

    private async closeSession(sessionId: string): Promise<void> {
        if (this.closed) return;
        await this.lifecycle.closeSession(sessionId);
        this.scheduleRefresh('session-close');
    }
    private async resetTask(path: string): Promise<void> {
        const target = resolveBrowserTarget(path);
        if (this.closed || target.kind !== 'task') return;
        const key = `${target.sessionId}/${target.taskId}`;
        if (this.resettingTasks.has(key)) return;
        this.resettingTasks.add(key);
        try {
            // Kernel cancellation fences execution, cancels pending interactions and
            // propagates to children. Never rewrite checkpoints or erase DAG/history.
            await this.kernel.cancel(target.sessionId, target.taskId, '用户强制复位任务：停止执行，保留历史与 DAG');
            const task = await this.kernel.task(target.sessionId, target.taskId);
            if (Object.values(task.effects).some(effect => effect.cleanupPending)) {
                throw new Error('任务已停止调度，但运行资源仍待清理；执行记录已保留');
            }
            this.scheduleRefresh('task-reset');
        } finally {
            this.resettingTasks.delete(key);
        }
    }
    /** Diagnostic counter — enabled with localStorage['vfs:debug']='1'. */
    private noteKernelChange(reason: string): void {
        if (!debugEnabled()) return;
        this.kernelChanges[reason] = (this.kernelChanges[reason] ?? 0) + 1;
    }
    /**
     * Coalesce a burst of structural changes (Task created → started → finished)
     * into one sidebar re-render. Content changes never reach here.
     */
    private scheduleRefresh(source: string): void {
        if (this.closed) return;
        this.refreshSources.add(source);
        if (this.refreshTimer) return;
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = undefined;
            this.refresh();
        }, 120);
    }
    private refresh(): void {
        if (this.closed || this.refreshQueued) return;
        this.refreshQueued = true;
        if (debugEnabled()) {
            const now = performance.now();
            console.debug(
                `[SessionWorkbench] refresh #${++this.refreshCount} (${[...this.refreshSources].join(', ') || 'explicit'})`
                + ` +${Math.round(now - this.lastRefreshAt)}ms kernel=${JSON.stringify(this.kernelChanges)}`,
            );
            this.lastRefreshAt = now;
            this.refreshSources.clear();
            this.kernelChanges = {};
        }
        this.refreshTail = this.refreshTail.catch(() => {}).then(async () => {
            this.refreshQueued = false;
            if (this.closed) return;
            await this.sidebarUI?.refresh();
            await this.syncBranchRoute();
            for (const id of this.waiting) this.sidebarUI?.setNodeWaitingInput('/' + id, true);
            if (this.active?.startsWith('/')) {
                const target = resolveBrowserTarget(this.active);
                if (target.kind === 'task') await this.showTask(this.active);
                else if (target.kind === 'folder' || target.kind === 'tasks' || (target.kind === 'files' && !this.editor && !this.previewCleanup)) await this.showDirectory(this.active);
            }
        }).catch(error => this.report(error));
    }
    private message(text: string): void {
        const node = document.createElement('div'); node.className = 'mm-placeholder'; node.textContent = text;
        this.container.replaceChildren(node);
    }
    private report(error: unknown): void {
        if (this.closed) return;
        const text = error instanceof Error ? error.message : String(error);
        if (!this.editor && !this.previewCleanup) this.message(text);
        else {
            const notice = document.createElement('div'); notice.className = 'session-detail__error';
            notice.setAttribute('role', 'alert'); notice.textContent = text; this.container.append(notice);
        }
    }
    openResource(resourceId: string, options: { reload?: boolean; branch?: string } = {}): Promise<void> {
        const route = parseSessionRoute(resourceId);
        const path = route.path;
        if (isFlowPath(path)) {
            return Promise.resolve(this.hostContext?.navigate?.({ target: 'flows',
                ...(path === '/@flows' ? {} : { resourceId: path.slice('/@flows'.length) }) }));
        }
        const branch = options.branch ?? route.branch;
        const target = resolveBrowserTarget(path);
        const id = target.kind === 'session' ? target.sessionId : path;
        const operation = this.tail.then(async () => {
            if (this.closed) throw new Error('Session workspace closed');
            if (id === this.active && !options.reload && (branch === undefined || branch === this.activeBranch)) return;
            if (target.kind === 'folder') {
                await this.closeEditor();
                this.active = id;
                this.activeBranch = undefined;
                await this.showDirectory(path);
                this.onSelect(id);
                this.selectionSync = path;
                try { await this.sidebarUI?.selectPath(path); } finally { this.selectionSync = undefined; }
                return;
            }
            const manifest = await this.repository.getManifest(target.sessionId);
            await this.closeEditor();
            if (target.kind === 'session' || target.kind === 'files') {
                const cwd = target.kind === 'session' ? undefined : target.path.slice(0, target.path.lastIndexOf('/')) || '/';
                const context = await this.files.acquireFiles(target.sessionId, cwd);
                let assets: FileSystemView | undefined;
                let editor: IEditor | undefined;
                let previewCleanup: (() => void) | undefined;
                const mount = document.createElement('div'); mount.className = 'session-editor-mount';
                this.container.replaceChildren(mount);
                try {
                    if (target.kind === 'files' && (await context.context.fs.driver.getNode(target.path))?.type === 'directory') {
                        await context.release();
                        await this.showDirectory(path);
                    } else if (target.kind === 'session') {
                        assets = createFileSystemView({ viewId: `editor-attachments:${target.sessionId}`, mounts: [{ mountId: 'attachments', at: '/', root: '/attachments', fs: context.context.fs, access: 'rw' }] });
                        editor = await this.factory(mount, { target: { kind: 'session', sessionId: target.sessionId, branch: branch ?? manifest.currentBranch ?? 'main' }, files: context.context, assets, title: manifest.title,
                            hostContext: { ...this.hostContext!, directoryCommands: this.directoryMounts ? {
                                configureWorkspace: async mode => {
                                    if (await showMountDialog(this.directoryMounts!, this.files, target.sessionId, mode, this.dialogs.signal)) {
                                        await this.reloadAfterMount(target.sessionId);
                                    }
                                },
                                addDirectory: async (directory, access) => {
                                    if (!directory) { await this.manageMounts(target.sessionId); return '挂载管理已关闭'; }
                                    try {
                                        const result = await this.directoryMounts!.addDirectory(target.sessionId, directory, access);
                                        await this.reloadAfterMount(target.sessionId); return result;
                                    } catch (error) { throw localizeMountError(error); }
                                },
                                setHome: async directory => {
                                    try {
                                        if (directory) { const result = await this.directoryMounts!.setHome(directory); await this.reloadAfterMount(target.sessionId); return result; }
                                        if (await showMountDialog(this.directoryMounts!, this.files, target.sessionId, 'home', this.dialogs.signal)) await this.reloadAfterMount(target.sessionId); return '默认目录设置已关闭';
                                    } catch (error) { throw localizeMountError(error); }
                                },
                            } : undefined, toggleSidebar: () => this.sidebarUI?.toggleSidebar() } });
                    } else {
                        const bytes = await context.context.fs.driver.readContent(target.path, { encoding: 'binary' });
                        let content: string | undefined;
                        try {
                            const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
                            const binaryExtension = /\.(pdf|zip|gz|tar|7z|rar|png|jpe?g|gif|webp|avif|ico|mp[34]|wav|ogg|webm|mov|woff2?|ttf|bin|sqlite|db|docx?|xlsx?|pptx?)$/i.test(target.path);
                            if (!binaryExtension && !decoded.includes('\0')) content = decoded;
                        } catch { /* Binary content is downloaded without decoding. */ }
                        if (content === undefined) {
                            previewCleanup = this.showBinary(mount, target.path, bytes);
                        } else {
                            const readOnly = (await context.context.fs.capabilitiesAt(target.path)).readonly;
                            editor = await this.fileFactory(mount, { target: { kind: 'file', path: target.path }, files: context.context,
                                initialContent: content, title: target.path.split('/').pop(), readOnly,
                                hostContext: { toggleSidebar: () => this.sidebarUI?.toggleSidebar(), navigate: request => this.hostContext?.navigate(request) ?? Promise.resolve(),
                                    saveContent: readOnly ? undefined : async (_path, text) => {
                                        // A failed write must never look like a successful save: the
                                        // editor keeps its dirty state, and the user is told now.
                                        try { await context.context.fs.driver.writeContent(target.path, text); }
                                        catch (error) { this.report(error); throw error; }
                                        this.refresh();
                                    } },
                            });
                        }
                    }
                    if (this.closed) throw new Error('Session workspace closed');
                    if (editor || previewCleanup) {
                        this.editor = editor; this.context = context; this.assets = assets; this.previewCleanup = previewCleanup;
                        // L4: an open file activates Skills whose globs match it.
                        if (target.kind === 'files') this.mountEditorSkills(target.sessionId, target.path);
                    }
                } catch (error) {
                    try { previewCleanup?.(); await editor?.destroy(); } finally { await Promise.allSettled([assets?.dispose(), context.release()]); mount.remove(); }
                    throw error;
                }
            } else if (target.kind === 'tasks') await this.showDirectory(path);
            else await this.showTask(path);
            if (this.closed) throw new Error('Session workspace closed');
            this.active = id;
            this.activeBranch = target.kind === 'session' ? branch ?? manifest.currentBranch ?? 'main' : undefined;
            this.onSelect(this.getActiveResourceId()!);
            this.selectionSync = path;
            try { await this.sidebarUI?.selectPath(path); } finally { this.selectionSync = undefined; }
        });
        this.tail = operation.catch(() => {}); return operation;
    }
    private async syncBranchRoute(): Promise<void> {
        // Serialize reconciliation with navigation so a stale read cannot close a newer editor.
        const operation = this.tail.then(async () => {
            if (this.closed || !this.active) return;
            const id = this.active, target = resolveBrowserTarget(id.startsWith('/') ? id : '/' + id);
            if (target.kind === 'folder') return;
            const manifest = await this.repository.getManifest(target.sessionId).catch(async error => {
                if (error?.code !== 'ENOENT') throw error;
                await this.closeEditor();
                this.message('选择一个会话，或新建会话');
                this.onSelect('', 'replace');
                return undefined;
            });
            if (this.closed || !manifest || this.activeBranch === undefined || !this.editor) return;
            const current = manifest.currentBranch ?? 'main';
            if (current !== this.activeBranch) {
                this.activeBranch = current;
                this.onSelect(sessionRoute(id, current), 'push');
            }
        });
        this.tail = operation.catch(() => {});
        await operation;
    }
    private async reloadAfterMount(sessionId: string): Promise<void> {
        if (this.closed) return;
        this.refresh();
        if (this.active === sessionId) {
            const manifest = await this.repository.getManifest(sessionId);
            await this.openResource(sessionId, { reload: true, branch: manifest.currentBranch });
        }
    }
    private async manageMounts(sessionId: string): Promise<void> {
        if (this.directoryMounts && await showMountDialog(this.directoryMounts, this.files, sessionId, 'mount', this.dialogs.signal)) await this.reloadAfterMount(sessionId);
    }
    private showBinary(mount: HTMLElement, path: string, bytes: ArrayBuffer): () => void {
        const extension = path.split('.').pop()?.toLowerCase() ?? '';
        const imageTypes: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif' };
        const url = URL.createObjectURL(new Blob([bytes], { type: imageTypes[extension] ?? 'application/octet-stream' }));
        const panel = document.createElement('div'); panel.className = 'session-detail';
        const title = document.createElement('h2'); title.textContent = path.split('/').pop() ?? path; panel.append(title);
        if (imageTypes[extension]) { const image = document.createElement('img'); image.src = url; image.alt = title.textContent; image.style.maxWidth = '100%'; panel.append(image); }
        const download = document.createElement('a'); download.href = url; download.download = title.textContent; download.textContent = '下载文件'; panel.append(download);
        mount.replaceChildren(panel);
        return () => URL.revokeObjectURL(url);
    }
    private async showDirectory(path: string): Promise<void> {
        if (!this.browser) throw new Error('Session browser not started');
        const target = resolveBrowserTarget(path);
        if (target.kind === 'tasks') return this.showTasks(target.sessionId);
        const generation = ++this.taskRefresh;
        const nodes = await this.navigationFiles!.driver.getChildren(path);
        if (this.closed || generation !== this.taskRefresh) return;
        const panel = document.createElement('div'); panel.className = 'session-detail';
        const heading = document.createElement('h2');
        heading.textContent = target.kind === 'folder'
            ? (path === '/' ? '会话' : decodeURIComponent(path.split('/').pop()!.replace(/^folder:/, '')))
            : path.endsWith('/tasks') ? 'Tasks' : 'Files';
        panel.append(heading);
        if (target.kind === 'files' && target.path === '/' && this.directoryMounts) {
            const button = document.createElement('button'); button.textContent = '挂载目录 / 管理挂载';
            button.onclick = () => { void this.manageMounts(target.sessionId).catch(error => this.report(error)); }; panel.append(button);
            if (nodes.every(node => node.name === 'attachments')) { const hint = document.createElement('p'); hint.textContent = '尚未挂载工作目录，此会话仅能访问附件'; panel.append(hint); }
        }
        if (target.kind === 'files' && target.path === '/' && this.manageMemory) {
            const button = document.createElement('button'); button.textContent = t('memory.manage.title');
            button.onclick = () => { void this.manageMemory!(target.sessionId, this.dialogs.signal).catch(error => this.report(error)); };
            panel.append(button);
        }
        for (const node of nodes) {
            const button = document.createElement('button'); button.type = 'button'; button.className = 'session-detail__entry';
            button.textContent = String(node.metadata.title ?? node.name);
            button.onclick = () => { void this.openResource(node.path).catch(error => this.report(error)); }; panel.append(button);
        }
        if (!nodes.length) { const empty = document.createElement('p'); empty.textContent = '暂无内容'; panel.append(empty); }
        if (!this.closed) this.container.replaceChildren(panel);
    }
    private async showTasks(sessionId: string): Promise<void> {
        const generation = ++this.taskRefresh;
        let exists = false;
        for await (const session of this.kernel.listSessions()) if (session.id === sessionId) { exists = true; break; }
        let page = exists ? await this.kernel.listSessionTaskPage(sessionId) : { items: [], throughIndex: 0, nextAfterIndex: undefined };
        if (this.closed || generation !== this.taskRefresh) return;
        const panel = document.createElement('div'); panel.className = 'session-detail';
        const heading = document.createElement('h2'); heading.textContent = 'Tasks'; panel.append(heading);
        const entries = document.createElement('div'); panel.append(entries);
        const more = document.createElement('button'); more.type = 'button'; more.textContent = '加载更多任务'; panel.append(more);
        const append = () => {
            for (const task of page.items) {
                const button = document.createElement('button'); button.type = 'button'; button.className = 'session-detail__entry';
                button.textContent = `${task.program.kind} · ${task.status} · ${task.id}`;
                button.onclick = () => { void this.openResource(`/${sessionId}/tasks/${task.id}`).catch(error => this.report(error)); }; entries.append(button);
            }
            more.hidden = page.nextAfterIndex === undefined;
        };
        append();
        if (!page.items.length) { const empty = document.createElement('p'); empty.textContent = '暂无内容'; entries.append(empty); }
        more.onclick = () => {
            if (more.disabled || page.nextAfterIndex === undefined) return;
            more.disabled = true;
            void this.kernel.listSessionTaskPage(sessionId, { afterIndex: page.nextAfterIndex, throughIndex: page.throughIndex }).then(next => {
                if (this.closed || generation !== this.taskRefresh) return;
                page = next; append();
            }).catch(error => this.report(error)).finally(() => { more.disabled = false; });
        };
        this.container.replaceChildren(panel);
    }
    private async showTask(path: string): Promise<void> {
        const target = resolveBrowserTarget(path); if (target.kind !== 'task') return;
        const generation = ++this.taskRefresh;
        const task = await this.kernel.task(target.sessionId, target.taskId);
        let eventPage = await this.kernel.taskEventPage(target.sessionId, target.taskId);
        const projectEvents = (items: typeof eventPage.items) => items
            .filter(event => event.taskId === target.taskId).map(taskKeyEvent).filter(event => event !== undefined);
        const events = projectEvents(eventPage.items);
        if (this.closed || generation !== this.taskRefresh) return;
        const panel = document.createElement('div'); panel.className = 'session-detail';
        const heading = document.createElement('h2'); heading.textContent = `${task.program.kind} · ${task.status}`; panel.append(heading);
        // Distinguish "the request was accepted" from "the external work really stopped":
        // only the confirmed case may read as stopped. Pause is projected the same way, so a
        // task paused by a Flow or another host does not silently render no state at all.
        const stat = taskStat(task), control = stat.control;
        const stop = document.createElement('p');
        const kind = control.requested === 'cancel' ? 'cancel' : control.requested === 'pause' ? 'pause' : undefined;
        stop.dataset.stopState = !kind ? 'none'
            : kind === 'cancel' ? (control.acknowledged ? 'stopped' : 'pending')
            : (control.acknowledged ? 'paused' : 'pause-pending');
        stop.textContent = !kind ? ''
            : kind === 'cancel' ? (control.acknowledged ? t('session.tasks.stopStopped')
                : t('session.tasks.stopPending', { count: stat.activeOperations }))
            : (control.acknowledged ? t('session.tasks.pauseStopped')
                : t('session.tasks.pausePending', { count: stat.activeOperations }));
        stop.hidden = !kind;
        panel.append(stop);
        const description = document.createElement('p'); description.textContent = task.id; panel.append(description);
        const result = document.createElement('pre'); result.textContent = JSON.stringify(taskSummary(task), null, 2); panel.append(result);
        const entries = document.createElement('div'); panel.append(entries);
        // Retention may have dropped the oldest events; say so instead of silently
        // showing a shorter history (the page also reports `firstAvailableIndex`).
        let watermark = eventPage.firstAvailableIndex ?? 1;
        const trimmed = document.createElement('p');
        trimmed.dataset.eventsTrimmed = 'true';
        trimmed.textContent = t('session.tasks.eventsTrimmed');
        panel.append(trimmed);
        const moreEvents = document.createElement('button'); moreEvents.type = 'button'; moreEvents.textContent = '继续查找关键事件'; panel.append(moreEvents);
        const render = () => {
            trimmed.hidden = watermark <= 1;
            trimmed.dataset.eventsTrimmedFrom = String(watermark);
            entries.replaceChildren();
            moreEvents.hidden = eventPage.nextAfterIndex === undefined;
            const records = events.map(event => ({ time: event.occurredAt, title: event.type, value: event }));
            if (!records.length) {
                const empty = document.createElement('p'); empty.textContent = '已读取范围内无关键事件'; entries.append(empty);
            }
            for (const record of records.sort((a, b) => a.time - b.time)) {
                const detail = document.createElement('details'); const summary = document.createElement('summary');
                summary.textContent = `${new Date(record.time).toLocaleString()} · ${record.title}`;
                const body = document.createElement('pre'); body.textContent = JSON.stringify(record.value, null, 2);
                detail.append(summary, body); entries.append(detail);
            }
        };
        moreEvents.onclick = () => {
            if (moreEvents.disabled || eventPage.nextAfterIndex === undefined) return;
            moreEvents.disabled = true;
            void this.kernel.taskEventPage(target.sessionId, target.taskId, {
                afterIndex: eventPage.nextAfterIndex, throughIndex: eventPage.throughIndex,
            }).then(next => {
                if (this.closed || generation !== this.taskRefresh) return;
                eventPage = next;
                watermark = Math.max(watermark, next.firstAvailableIndex ?? 1);
                events.push(...projectEvents(next.items)); render();
            }).catch(error => this.report(error)).finally(() => { moreEvents.disabled = false; });
        };
        render();
        this.container.replaceChildren(panel);
    }
    private async exportSessionItem(item: { path: string; type: string }): Promise<{ name: string; content: string; mimeType: string } | null> {
        const target = resolveBrowserTarget(item.path);
        if (target.kind !== 'session') return null;
        return exportSessionBundle(this.repository, target.sessionId);
    }

    async createResource(options: { title?: string } = {}): Promise<string> {
        if (this.closed) throw new Error('Session workspace closed');
        const id = await this.repository.createSession(options.title || '新会话');
        const opening = this.openResource(id);
        await Promise.all([opening, this.sidebarUI?.refresh()]);
        if (!this.closed && this.active === id) {
            // The editor can finish before its new sidebar entry is available.
            this.selectionSync = '/' + id;
            try { await this.sidebarUI?.selectPath('/' + id); } finally { this.selectionSync = undefined; }
        }
        return id;
    }
    getActiveResourceId(): string | null {
        return this.active && this.activeBranch !== undefined ? sessionRoute(this.active, this.activeBranch) : this.active;
    }
    setWaitingInput(id: string, waiting: boolean): void {
        waiting ? this.waiting.add(id) : this.waiting.delete(id); this.sidebarUI?.setNodeWaitingInput('/' + id, waiting);
    }
    /** Editor open/close drives the L4 glob mount; a failure must not break the editor. */
    private mountEditorSkills(sessionId: string, path: string): void {
        this.openEditorTarget = { sessionId, path };
        void this.sessionSkills?.mountByGlob(sessionId, path).catch(error => this.report(error));
    }

    private async unmountEditorSkills(): Promise<void> {
        const open = this.openEditorTarget;
        this.openEditorTarget = undefined;
        if (open) await this.sessionSkills?.unmountByGlob(open.sessionId, open.path).catch(error => this.report(error));
    }

    private async closeEditor(): Promise<void> {
        ++this.taskRefresh;
        this.previewCleanup?.(); this.previewCleanup = undefined;
        const editor = this.editor, assets = this.assets, context = this.context;
        this.editor = undefined; this.assets = undefined; this.context = undefined; this.active = null;
        this.activeBranch = undefined;
        try { await editor?.destroy(); } finally {
            await this.unmountEditorSkills();
            await Promise.all([assets?.dispose(), context?.release()]);
        }
    }
    async destroy(): Promise<void> {
        this.closed = true; this.dialogs.abort(); this.unsubscribers.splice(0).forEach(unsubscribe => unsubscribe());
        if (this.refreshTimer) { clearTimeout(this.refreshTimer); this.refreshTimer = undefined; }
        await Promise.all([this.tail, this.refreshTail]); await this.closeEditor(); this.sidebarUI?.destroy();
        await this.navigationFiles?.dispose(); await this.browser?.dispose(); this.container.replaceChildren();
    }
}

/** Session and Task entries are virtual containers, not writable creation directories. */
function sessionCreationParent(path: string | null): string | null {
    if (!path) return null;
    if (isFlowPath(path)) return null;
    const target = resolveBrowserTarget(path);
    if (target.kind === 'folder' || target.kind === 'files') return path;
    const folders = path.split('/').filter(Boolean);
    const sessionIndex = folders.findIndex(segment => !segment.startsWith('folder:'));
    return sessionIndex > 0 ? '/' + folders.slice(0, sessionIndex).join('/') : null;
}

function isFlowPath(path: string): boolean { return path === '/@flows' || path.startsWith('/@flows/'); }
