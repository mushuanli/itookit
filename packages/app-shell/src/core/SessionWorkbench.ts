import { showMountDialog } from '../files/mount-dialog';
import type { DirectoryMountService } from '../files/directory-mounts';
import type { EditorFactory, IEditor, EditorHostContext } from '@itookit/ui-common';
import type { ISessionRepository } from '@itookit/llm-session';
import type { Kernel } from '@itookit/durable-kernel';
import { createVFSUI, type VFSUIShell } from '@itookit/vfs-ui';
import { createFileSystemView, type FileSystemContextOwner, type FileSystemView, type FileSystemSourceOwner } from '@itookit/vfs-core';
import type { SessionFilesService } from '../files/session-files';
import { createSessionBrowser, resolveBrowserTarget, taskSummary } from '../files/session-browser';
import { parseSessionRoute, sessionRoute } from '../files/session-route';
import type { WorkspaceController } from './WorkspaceController';

/** vfs-ui owns the sidebar; this host owns business views and their file leases. */
export class SessionWorkbench implements WorkspaceController {
    private readonly dialogs = new AbortController();
    private editor?: IEditor;
    private previewCleanup?: () => void;
    private context?: FileSystemContextOwner;
    private assets?: FileSystemView;
    private browser?: FileSystemSourceOwner;
    private sidebarUI?: VFSUIShell;
    private active: string | null = null;
    private activeBranch?: string;
    private selectionSync?: string;
    private closed = false;
    private tail: Promise<void> = Promise.resolve();
    private refreshTail: Promise<void> = Promise.resolve();
    private unsubscribers: Array<() => void> = [];
    private taskRefresh = 0;
    private refreshQueued = false;
    private readonly waiting = new Set<string>();
    constructor(private readonly sidebar: HTMLElement, private readonly container: HTMLElement,
        private readonly repository: ISessionRepository, private readonly files: SessionFilesService,
        private readonly factory: EditorFactory, private readonly onSelect: (id: string, mode?: 'push' | 'replace') => void,
        private readonly hostContext: EditorHostContext | undefined, private readonly kernel: Kernel,
        private readonly fileFactory: EditorFactory, private readonly directoryMounts?: DirectoryMountService) {}
    async start(): Promise<void> {
        this.browser = await createSessionBrowser({ repository: this.repository, files: this.files, kernel: this.kernel });
        this.sidebarUI = createVFSUI({ sessionListContainer: this.sidebar, title: '会话', scopeId: 'session-browser:v1:admin',
            readOnly: true, activateDirectories: true, defaultUiSettings: { sortBy: 'lastModified' },
            directoryAction: this.directoryMounts ? { label: '＋ 挂载目录', visible: path => /^\/[^/]+\/files$/.test(path), run: path => this.manageMounts(resolveBrowserTarget(path).sessionId) } : undefined,
            primaryAction: { label: '＋ 新建会话', run: async () => { await this.createResource(); } },
        }, this.browser.fs) as VFSUIShell;
        this.unsubscribers.push(this.sidebarUI.on('sessionSelected', ({ item }) => {
            // Expanding ancestors during selectPath can emit intermediate selections too.
            if (item && !this.selectionSync) void this.openResource(item.id).catch(error => this.report(error));
        }), this.sidebarUI.on('sidebarStateChanged', ({ isCollapsed }) => this.sidebar.classList.toggle('is-collapsed', isCollapsed)),
        this.repository.subscribe(() => this.refresh()), this.files.subscribe(() => this.refresh()), this.kernel.onChanged(() => this.refresh()));
        await this.sidebarUI.start();
        if (!this.active) this.message('选择一个会话，或新建会话');
    }
    private refresh(): void {
        if (this.closed || this.refreshQueued) return;
        this.refreshQueued = true;
        this.refreshTail = this.refreshTail.catch(() => {}).then(async () => {
            this.refreshQueued = false;
            if (this.closed) return;
            await this.sidebarUI?.refresh();
            await this.syncBranchRoute();
            for (const id of this.waiting) this.sidebarUI?.setNodeWaitingInput('/' + id, true);
            if (this.active?.startsWith('/')) {
                const target = resolveBrowserTarget(this.active);
                if (target.kind === 'task') await this.showTask(this.active);
                else if (target.kind === 'tasks' || (target.kind === 'files' && !this.editor && !this.previewCleanup)) await this.showDirectory(this.active);
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
        const branch = options.branch ?? route.branch;
        const target = resolveBrowserTarget(path);
        const id = target.kind === 'session' ? target.sessionId : path;
        const operation = this.tail.then(async () => {
            if (this.closed) throw new Error('Session workspace closed');
            if (id === this.active && !options.reload && (branch === undefined || branch === this.activeBranch)) return;
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
                        editor = await this.factory(mount, { target: { kind: 'session', sessionId: target.sessionId, branch: branch ?? 'main' }, files: context.context, assets, title: manifest.title,
                            hostContext: { ...this.hostContext!, directoryCommands: this.directoryMounts ? {
                                addDirectory: async (directory, access) => {
                                    if (!directory) { await this.manageMounts(target.sessionId); return '挂载管理已关闭'; }
                                    const result = await this.directoryMounts!.addDirectory(target.sessionId, directory, access);
                                    await this.reloadAfterMount(target.sessionId); return result;
                                },
                                setHome: async directory => {
                                    if (directory) { const result = await this.directoryMounts!.setHome(directory); await this.reloadAfterMount(target.sessionId); return result; }
                                    if (await showMountDialog(this.directoryMounts!, this.files, target.sessionId, 'home', this.dialogs.signal)) await this.reloadAfterMount(target.sessionId); return '默认目录设置已关闭';
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
                                    saveContent: readOnly ? undefined : async (_path, text) => { await context.context.fs.driver.writeContent(target.path, text); this.refresh(); } },
                            });
                        }
                    }
                    if (this.closed) throw new Error('Session workspace closed');
                    if (editor || previewCleanup) { this.editor = editor; this.context = context; this.assets = assets; this.previewCleanup = previewCleanup; }
                } catch (error) {
                    try { previewCleanup?.(); await editor?.destroy(); } finally { await Promise.allSettled([assets?.dispose(), context.release()]); mount.remove(); }
                    throw error;
                }
            } else if (target.kind === 'tasks') await this.showDirectory(path);
            else await this.showTask(path);
            if (this.closed) throw new Error('Session workspace closed');
            this.active = id;
            this.activeBranch = target.kind === 'session' ? branch ?? 'main' : undefined;
            this.onSelect(this.getActiveResourceId()!);
            this.selectionSync = path;
            try { await this.sidebarUI?.selectPath(path); } finally { this.selectionSync = undefined; }
        });
        this.tail = operation.catch(() => {}); return operation;
    }
    private async syncBranchRoute(): Promise<void> {
        const id = this.active, branch = this.activeBranch;
        if (!id || branch === undefined || !this.editor) return;
        const manifest = await this.repository.getManifest(id);
        if (this.closed || this.active !== id || this.activeBranch !== branch || !this.editor) return;
        const current = manifest.currentBranch ?? 'main';
        if (current !== branch) {
            this.activeBranch = current;
            this.onSelect(sessionRoute(id, current), 'push');
        }
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
        const nodes = await this.browser.fs.driver.getChildren(path);
        if (this.closed || generation !== this.taskRefresh) return;
        const panel = document.createElement('div'); panel.className = 'session-detail';
        const heading = document.createElement('h2'); heading.textContent = path.endsWith('/tasks') ? 'Tasks' : 'Files'; panel.append(heading);
        if (target.kind === 'files' && target.path === '/' && this.directoryMounts) {
            const button = document.createElement('button'); button.textContent = '挂载目录 / 管理挂载';
            button.onclick = () => { void this.manageMounts(target.sessionId).catch(error => this.report(error)); }; panel.append(button);
            if (nodes.every(node => node.name === 'attachments')) { const hint = document.createElement('p'); hint.textContent = '尚未挂载工作目录，此会话仅能访问附件'; panel.append(hint); }
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
        let [page, eventPage] = await Promise.all([this.kernel.taskHistoryPage(target.sessionId, target.taskId), this.kernel.taskEventPage(target.sessionId, target.taskId)]);
        const history = [...page.items];
        const events = [...eventPage.items];
        if (this.closed || generation !== this.taskRefresh) return;
        const panel = document.createElement('div'); panel.className = 'session-detail';
        const heading = document.createElement('h2'); heading.textContent = `${task.program.kind} · ${task.status}`; panel.append(heading);
        const description = document.createElement('p'); description.textContent = task.id; panel.append(description);
        const entries = document.createElement('div'); panel.append(entries);
        const more = document.createElement('button'); more.type = 'button'; more.textContent = '加载更多版本'; panel.append(more);
        const moreEvents = document.createElement('button'); moreEvents.type = 'button'; moreEvents.textContent = '加载更多事件'; panel.append(moreEvents);
        const render = () => {
            entries.replaceChildren();
            more.hidden = page.nextAfterVersion === undefined;
            moreEvents.hidden = eventPage.nextAfterIndex === undefined;
            const records: Array<{ time: number; title: string; value: unknown }> = history.map(record => ({ time: record.updatedAt, title: `版本 ${record.version} · ${record.status}`, value: taskSummary(record) }));
            for (const event of events) if (event.taskId === target.taskId) records.push({ time: event.occurredAt, title: event.type, value: { sequence: event.sequence, type: event.type, occurredAt: event.occurredAt } });
            for (const record of records.sort((a, b) => a.time - b.time)) {
                const detail = document.createElement('details'); const summary = document.createElement('summary');
                summary.textContent = `${new Date(record.time).toLocaleString()} · ${record.title}`;
                const body = document.createElement('pre'); body.textContent = JSON.stringify(record.value, null, 2);
                detail.append(summary, body); entries.append(detail);
            }
        };
        more.onclick = () => {
            if (more.disabled || page.nextAfterVersion === undefined) return;
            more.disabled = true;
            void this.kernel.taskHistoryPage(target.sessionId, target.taskId, {
                afterVersion: page.nextAfterVersion, throughVersion: page.throughVersion,
            }).then(next => {
                if (this.closed || generation !== this.taskRefresh) return;
                page = next; history.push(...next.items); render();
            }).catch(error => this.report(error)).finally(() => { more.disabled = false; });
        };
        moreEvents.onclick = () => {
            if (moreEvents.disabled || eventPage.nextAfterIndex === undefined) return;
            moreEvents.disabled = true;
            void this.kernel.taskEventPage(target.sessionId, target.taskId, {
                afterIndex: eventPage.nextAfterIndex, throughIndex: eventPage.throughIndex,
            }).then(next => {
                if (this.closed || generation !== this.taskRefresh) return;
                eventPage = next; events.push(...next.items); render();
            }).catch(error => this.report(error)).finally(() => { moreEvents.disabled = false; });
        };
        render();
        this.container.replaceChildren(panel);
    }
    async createResource(options: { title?: string } = {}): Promise<string> {
        if (this.closed) throw new Error('Session workspace closed');
        const id = await this.repository.createSession(options.title || '新会话');
        await this.sidebarUI?.refresh(); await this.openResource(id); return id;
    }
    getActiveResourceId(): string | null {
        return this.active && this.activeBranch !== undefined ? sessionRoute(this.active, this.activeBranch) : this.active;
    }
    setWaitingInput(id: string, waiting: boolean): void {
        waiting ? this.waiting.add(id) : this.waiting.delete(id); this.sidebarUI?.setNodeWaitingInput('/' + id, waiting);
    }
    private async closeEditor(): Promise<void> {
        ++this.taskRefresh;
        this.previewCleanup?.(); this.previewCleanup = undefined;
        const editor = this.editor, assets = this.assets, context = this.context;
        this.editor = undefined; this.assets = undefined; this.context = undefined; this.active = null;
        this.activeBranch = undefined;
        try { await editor?.destroy(); } finally { await Promise.all([assets?.dispose(), context?.release()]); }
    }
    async destroy(): Promise<void> {
        this.closed = true; this.dialogs.abort(); this.unsubscribers.splice(0).forEach(unsubscribe => unsubscribe());
        await Promise.all([this.tail, this.refreshTail]); await this.closeEditor(); this.sidebarUI?.destroy();
        await this.browser?.dispose(); this.container.replaceChildren();
    }
}
