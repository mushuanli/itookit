import { projectTransferTargets } from './transfer-targets';
import { ProjectSyncMenu } from './sync/menu';
import { createMindOSVFSUI as createVFSUI } from '../browser/vfs-presentation';
import { WorkbenchTabs, type WorkbenchTab } from '../workbench/tabs';
import { WorkbenchSidebar } from '../workbench/sidebar';
import { createDirectoryList, refreshDirectoryList, watchDirectorySelection } from '../workbench/directory-list';
import { directoryBulkActions } from '../workbench/vfs-actions';
import { ENTITY_ICONS, FILE_BROWSER_ICONS, FILE_ICONS } from '@itookit/common';
import { watchDirectoryList } from '../workbench/directory-watch';
import type { WorkbenchStatePort } from '../workbench/state';
import { projectFavoriteAction } from './project-favorites';
import { directoryEntryName, directoryPathLabel } from './directory-label';
import { WORKSPACE_PATH, projectRelativePath, resolveProjectFavorite } from '@itookit/app-core';
import { createProjectDraftControls } from './project-draft-editor';
import { monitorRemoteConnections } from '../files/remote-status-monitor';
import { EditorLease } from '../browser/editor-lease';
import { openProjectFileEditor, localizeRemoteWriteError } from './project-file-editor';
import { fileContentFormat } from '../browser/file-format';
import { ViewLoad, ViewLoadCancelled, LatestViewLoad } from '../lifecycle/view-load';
import { SubscriptionScope } from '../lifecycle/subscription-scope';
import { archiveTarget, archiveTargetPath } from './archive-targets';
import { chooseArchive, downloadArchive } from '../files/archive-transfer';
import { SessionFamilyActions } from './SessionFamilyActions';
import { buildRenamedFilename, formatDefaultFileTitle, t, traceBoot } from '@itookit/common';
import { type SessionSkillControls } from '@itookit/tools/contracts';
import { ProjectNavigation, type ProjectFileView } from './ProjectNavigation';
import { remapProjectPath } from './project-paths';
import { showNameDialog, showProjectDialog } from '../files/project-dialog';
import { showMountDialog } from '../files/mount-dialog';
import { localizeMountError } from '../files/localize-mount-error';

import type { EditorFactory, IEditor, EditorHostContext, ContextMenuConfig } from '@itookit/ui-common';
import type { ISessionRepository } from '@itookit/llm-session';
import type { Kernel } from '@itookit/durable-kernel';
import { allowsRowAction, filterGitignoredFiles, describeErrorReason, describeCauseChain, type VFSToolbarContext, type VFSUIShell, type VFSNodeUI, type UIPersistencePort } from '@itookit/vfs-ui';
import { FSError, createFileSystemView, type IFileSystem, type FileSystemContextOwner, type FileSystemView } from '@itookit/vfs-core';



import { taskStat } from '@itookit/durable-kernel';
import { browserTargetFolder, createSessionBrowser, folderBrowserPath, folderPathFromBrowserPath, exportSessionBundle, parseSessionRoute, resolveBrowserTarget, sessionRoute, taskSummary, taskKeyEvent,
    WorkbenchArchiveExporter, WorkbenchArchiveImporter, SessionLifecycleService, ProjectSessions, type ProjectService, type DirectoryMountService, type SessionFilesService, type WorkspaceController } from '@itookit/app-core';

/** Sidebar refresh tracing — enable with localStorage['vfs:debug']='1' (same flag as vfs-ui). */
function debugEnabled(): boolean {
    try { return typeof localStorage !== 'undefined' && localStorage.getItem('vfs:debug') === '1'; } catch { return false; }
}

const fileNames = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

/** Stable identity of the sidebar's restored UI state; the host persists it per scope. */
export const SESSION_BROWSER_SCOPE = 'session-browser:v1:admin';

/** One navigation request. `fileNavigation` decides how the content column follows a file. */
export interface OpenResourceOptions {
    initialInputState?: { text?: string; agentId?: string };
    reload?: boolean;
    preserveProject?: boolean;
    branch?: string;
    fileNavigation?: ProjectFileView;
}

/** File column behavior for a resolved favorite target. */
const fileViewFor = (kind: 'file' | 'directory' | 'session'): ProjectFileView | undefined =>
    kind === 'file' ? 'preserve' : kind === 'directory' ? 'directory' : undefined;

/** Sort Sessions by activity, and physical files by directory then natural name. */
function compareSessionEntries(a: VFSNodeUI, b: VFSNodeUI): number | undefined {
    if (a.presentation?.fileDetails && b.presentation?.fileDetails) {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return fileNames.compare(a.metadata.title, b.metadata.title) || a.id.localeCompare(b.id);
    }
    const isSession = (item: VFSNodeUI) => !isFlowPath(item.id) && resolveBrowserTarget(item.id).kind === 'session';
    const aSession = isSession(a), bSession = isSession(b);
    // Keep folder/Flow navigation together so mixed siblings have a transitive order.
    if (aSession !== bSession) return aSession ? 1 : -1;
    if (!aSession) return undefined;
    return Date.parse(b.metadata.lastModified) - Date.parse(a.metadata.lastModified) || a.id.localeCompare(b.id);
}

export interface SessionWorkbenchOptions {
    sidebar: HTMLElement;
    container: HTMLElement;
    repository: ISessionRepository;
    files: SessionFilesService;
    factory: EditorFactory;
    onSelect: (id: string, mode?: 'push' | 'replace') => void;
    hostContext: EditorHostContext | undefined;
    kernel: Kernel;
    fileFactory: EditorFactory;
    directoryMounts?: DirectoryMountService;
    sessionSkills?: SessionSkillControls;
    manageMemory?: (sessionId: string, signal: AbortSignal) => Promise<void>;
    flows?: { fs: IFileSystem; menu: ContextMenuConfig<VFSNodeUI> };
    projects?: ProjectService;
    projectSync?: import('@itookit/app-core').ProjectSyncService;
    projectSyncSetup?(projectId: string, signal: AbortSignal): Promise<void>;
    onSidebarReady?: () => boolean;
    initialResourceId?: string;
    /** Host-owned snapshot storage; omitted means the sidebar restores nothing. */
    uiPersistence?: UIPersistencePort;
    workbenchState?: WorkbenchStatePort;
}

function afterSidebarPaint(): Promise<void> {
    return new Promise(resolve => {
        if (typeof requestAnimationFrame !== 'function' || document.visibilityState === 'hidden') {
            setTimeout(resolve, 0); return;
        }
        requestAnimationFrame(() => setTimeout(resolve, 0));
    });
}

interface RetainedEditor {
    editor?: IEditor; context?: FileSystemContextOwner; assets?: FileSystemView;
    previewCleanup?: () => void; renameCleanup?: () => void;
    active: string | null; branch?: string; cancel?: () => void; lease?: EditorLease;
    skills?: { sessionId: string; path: string };
}

/** vfs-ui owns the sidebar; this host owns business views and their file leases. */
export class SessionWorkbench implements WorkspaceController {
    private readonly dialogs = new AbortController();
    private readonly tabs: WorkbenchTabs<RetainedEditor>;
    private readonly sidebarLayout: WorkbenchSidebar;
    private editor?: IEditor;
    private editorLease?: EditorLease;
    private previewCleanup?: () => void;
    private fileRenameCleanup?: () => void;
    private context?: FileSystemContextOwner;
    private assets?: FileSystemView;
    private browser?: Awaited<ReturnType<typeof createSessionBrowser>>;
    private navigationFiles?: FileSystemView;
    private sidebarUI?: VFSUIShell;
    private initialSidebarSelection?: string;
    private sidebarStarting = true;
    private projectNavigation?: ProjectNavigation;
    private readonly syncMenu: ProjectSyncMenu;
    private familyActions?: SessionFamilyActions;
    private lifecycle!: SessionLifecycleService;
    private active: string | null = null;
    private activeBranch?: string;
    private selectionSync?: string;
    private closed = false;
    private tail: Promise<void> = Promise.resolve();
    private refreshTail: Promise<void> = Promise.resolve();
    private readonly subscriptions = new SubscriptionScope();
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
    private readonly sidebar: SessionWorkbenchOptions['sidebar'];
    private readonly container: SessionWorkbenchOptions['container'];
    private readonly repository: SessionWorkbenchOptions['repository'];
    private readonly files: SessionWorkbenchOptions['files'];
    private readonly factory: SessionWorkbenchOptions['factory'];
    private readonly onSelect: SessionWorkbenchOptions['onSelect'];
    private readonly hostContext: SessionWorkbenchOptions['hostContext'];
    private readonly kernel: SessionWorkbenchOptions['kernel'];
    private readonly fileFactory: SessionWorkbenchOptions['fileFactory'];
    private readonly directoryMounts: SessionWorkbenchOptions['directoryMounts'];
    private readonly sessionSkills: SessionWorkbenchOptions['sessionSkills'];
    private readonly manageMemory: SessionWorkbenchOptions['manageMemory'];
    private readonly flows: SessionWorkbenchOptions['flows'];
    private readonly projects: SessionWorkbenchOptions['projects'];
    private readonly onSidebarReady: SessionWorkbenchOptions['onSidebarReady'];
    private readonly initialResourceId: SessionWorkbenchOptions['initialResourceId'];
    private readonly uiPersistence: SessionWorkbenchOptions['uiPersistence'];
    private readonly sessions: ProjectSessions;
    constructor(options: SessionWorkbenchOptions) {
        this.syncMenu = new ProjectSyncMenu({ service: options.projectSync, setup: options.projectSyncSetup }, this.dialogs.signal,
            error => this.report(error), async () => { if (!this.closed) { await this.sidebarUI?.refresh(); await this.projectNavigation?.refresh(); } });
        this.sidebar = options.sidebar;
        this.container = options.container;
        this.repository = options.repository;
        this.files = options.files;
        this.factory = options.factory;
        this.onSelect = options.onSelect;
        this.hostContext = options.hostContext;
        this.kernel = options.kernel;
        this.fileFactory = options.fileFactory;
        this.directoryMounts = options.directoryMounts;
        this.sessionSkills = options.sessionSkills;
        this.manageMemory = options.manageMemory;
        this.flows = options.flows;
        this.projects = options.projects;
        this.onSidebarReady = options.onSidebarReady;
        this.initialResourceId = options.initialResourceId;
        this.uiPersistence = options.uiPersistence;
        this.sessions = options.projects?.sessions ?? new ProjectSessions(options.repository);
        this.tabs = new WorkbenchTabs(this.container, {
            activate: id => this.openResource(id), dispose: tab => this.disposeTab(tab),
            empty: () => { this.clearEditorFields(); this.showWelcome(); this.onSelect('', 'replace'); },
            error: error => this.report(error), changed: () => this.sidebarLayout?.save(this.tabs.snapshot()),
        }, options.workbenchState?.load()?.tabs);
        this.sidebarLayout = new WorkbenchSidebar(this.sidebar, this.tabs.opened, options.workbenchState);
    }
    private isTransferFile(path: string): boolean {
        if (isFlowPath(path)) return false;
        const target = resolveBrowserTarget(path);
        return (target.kind === 'files' && target.path !== '/') || (target.kind === 'project-files' && target.path !== WORKSPACE_PATH);
    }

    async start(): Promise<void> {
        this.browser = await createSessionBrowser({ repository: this.repository, files: this.files, kernel: this.kernel, projects: this.projects,
            filterDisplayedFiles: filterGitignoredFiles });
        this.navigationFiles = createFileSystemView({ viewId: 'session-navigation:admin', mounts: [
            { mountId: 'sessions', at: '/', fs: this.browser.fs, access: 'rw' },
            ...(this.flows && !this.projects ? [{ mountId: 'flows', at: '/@flows', fs: this.flows.fs, access: 'rw' as const }] : []),
        ] });
        this.lifecycle = new SessionLifecycleService({ repository: this.repository, kernel: this.kernel });
        const tree = document.createElement('div'); tree.className = 'project-workbench__tree';
        this.sidebarLayout.navigation.append(tree);
        if (this.projects) this.installProjectNavigation();
        this.sidebarUI = createVFSUI({ sessionListContainer: tree, title: this.projects ? t('project.workspace') : '会话', scopeId: SESSION_BROWSER_SCOPE,
            persistence: this.uiPersistence,
            listItems: items => this.projectNavigation?.navigationItems(items, this.sidebarUI?.getSnapshot().query) ?? items,
            titleHeader: this.projectNavigation?.header, toolbarContainer: this.projectNavigation?.toolbarContainer,
            directoryAction: this.projectNavigation?.options.navigationAction,
            toolbarOptions: this.projectNavigation?.options.navigationToolbarOptions,
            rowCreation: { visible: node => !isFlowPath(node.id) && ['project-files', 'files'].includes(resolveBrowserTarget(node.id).kind),
                run: (node, type) => this.createDirectoryEntry(node.id, type) },
            transferPolicy: {
                targets: this.projects ? (ids, _mode, parent) => projectTransferTargets(this.projects!, this.navigationFiles!, ids, parent) : undefined,
                source: (node, mode) => mode === 'move' || this.isTransferFile(node.id),
                destination: (node, ids) => {
                    if (!node) return false;
                    const fileSources = ids.every(id => this.isTransferFile(id));
                    const target = resolveBrowserTarget(node.id);
                    return fileSources ? ['files', 'project-files'].includes(target.kind) : target.kind === 'folder';
                },
            },
            transferItems: async (mode, ids, destination) => {
                try {
                    if (ids.every(id => this.isTransferFile(id))) await this.browser!.transferItems(mode, ids, destination ?? '/');
                    else if (mode === 'move') await this.navigationFiles!.driver.move(ids, destination);
                    else throw new Error('Only files and file directories can be copied');
                } finally {
                    const tabs = this.tabs.values();
                    const refreshed = await Promise.allSettled(tabs.map(tab => refreshDirectoryList(tab.panel)));
                    refreshed.forEach((result, index) => {
                        if (result.status !== 'rejected') return;
                        console.error('[Project transfer]', { stage: 'refresh-view', mode, sources: ids, destination,
                            tabId: tabs[index]?.id, cause: describeCauseChain(result.reason), error: result.reason });
                        this.report(result.reason);
                    });
                }
            },
            toolbar: 'full', hideGitignored: false,
            searchPlaceholder: t(this.projects ? 'project.searchContents' : 'project.search'), showFileExtensions: true,
            readOnly: false, activateDirectories: true, autoSelectFirst: !this.projects, defaultUiSettings: { sortBy: 'lastModified' },
            compareItems: compareSessionEntries,
            restoreExpandedDirectory: isExpandableDirectory,
            exportDirectories: true,
            exportItem: item => this.exportSessionItem(item),
            favoriteAction: this.projects ? projectFavoriteAction(this.projects, this.repository) : undefined,
            onQuickDelete: async item => {
                const target = resolveBrowserTarget(item.id);
                if (target.kind === 'session') await this.removeSession(target.sessionId);
            },
            fileCreation: { label: '会话', title: formatDefaultFileTitle(), resolveParent: sessionCreationParent },
            contextMenu: {
                items: (item, defaults) => {
                    if (isFlowPath(item.id)) return this.flows?.menu.items?.(item,
                        item.id === '/@flows' ? [] : defaults.filter(entry => 'id' in entry && entry.id === 'delete')) ?? [];
                    const target = resolveBrowserTarget(item.id);
                    if (target.kind === 'favorite' || target.kind === 'favorites') return [];
                    if (target.kind === 'project-files' && target.path === WORKSPACE_PATH) return [];
                    if (this.projects && item.metadata?.custom?.projectId)
                        return [...defaults.filter(entry => !('id' in entry) || !['create-in-folder-session', 'create-in-folder-folder', 'import'].includes(entry.id)),
                            { type: 'separator' }, ...this.syncMenu.items(String(item.metadata.custom.projectId))];
                    if (target.kind === 'folder' && folderPathFromBrowserPath(item.id)?.endsWith('/@sessions'))
                        return defaults.filter(entry => !('id' in entry) || !['delete', 'rename'].includes(entry.id));
                    if (target.kind === 'task') {
                        return [{ id: 'reset-task', label: '强制复位任务（停止执行，保留记录）',
                            onClick: () => { void this.resetTask(item.id).catch(error => this.report(error)); } }];
                    }
                    // Closing stops the run but keeps the Session history, so it is offered
                    // next to (not instead of) the destructive delete.
                    if (target.kind === 'session') {
                        return [...defaults.filter(entry => !this.familyActions || !('id' in entry) || !['delete', 'create-in-folder-session', 'create-in-folder-folder'].includes(entry.id)),
                            ...(this.familyActions ? this.familyMenu(target.sessionId) : []),
                            { id: 'session-tasks', label: t('project.sessionTasks'), onClick: () => { void this.openResource(item.id + '/tasks').catch(error => this.report(error)); } },
                            { id: 'session-files', label: t('project.sessionFiles'), onClick: () => { void this.openResource(item.id + '/files').catch(error => this.report(error)); } },
                            { id: 'rerun-session', label: t('session.rerun.title'),
                            onClick: () => { void this.rerunSession(target.sessionId).catch(error => this.report(error)); } }, { id: 'close-session', label: t('session.close.action'),
                            onClick: () => { void this.closeSession(target.sessionId).catch(error => this.report(error)); } }];
                    }
                    return defaults;
                },
            },
        }, this.navigationFiles) as VFSUIShell;
        this.subscriptions.add(this.sidebarUI.on('sessionSelected', ({ item }) => {
            // Expanding ancestors during selectPath can emit intermediate selections too.
            if (!item || this.selectionSync) return;
            if (this.sidebarStarting) this.initialSidebarSelection = item.id;
            else void this.openResource(item.id, { preserveProject: true }).catch(error => this.report(error));
        }), this.sidebarUI.on('sidebarStateChanged', ({ isCollapsed }) => this.sidebar.classList.toggle('is-collapsed', isCollapsed)),
        this.repository.subscribe(change => { if (change?.kind !== 'ui-state') this.scheduleRefresh('repository'); }),
        this.files.subscribe(() => this.scheduleRefresh('files')),
        ...(this.projects ? [this.projects.favorites.subscribe(() => this.scheduleRefresh('favorites'))] : []),
        // Task content (stream deltas, logs, shared state) notifies many times per
        // second while a run streams. The sidebar only lists Sessions and Tasks, so
        // re-render on structural changes only — never per output chunk.
        this.kernel.onChanged(event => {
            this.noteKernelChange(event.reason);
            if (event.reason !== 'content') this.scheduleRefresh('kernel:' + event.reason);
        }));
        if (this.projects) this.subscriptions.add(this.projects.drafts.onPromoted(() => this.scheduleRefresh('project.draftPromoted')));
        await traceBoot('sessionWorkbench.sidebar', () => this.sidebarUI!.start());
        if (this.onSidebarReady?.()) await afterSidebarPaint();
        if (this.closed) return;
        this.sidebarStarting = false;
        if (this.projects?.remoteMounts) this.subscriptions.add(
            this.projects.remoteMounts.onChange(() => { this.updateRemoteAvailability(); this.scheduleRefresh('remote-status'); }), monitorRemoteConnections(this.projects));
        if (this.initialSidebarSelection && !this.initialResourceId) await this.openResource(this.initialSidebarSelection);
        if (this.projectNavigation && !this.active && !this.initialResourceId) {
            const current = await traceBoot('sessionWorkbench.currentProject', () => this.projects!.current());
            // The startup project is already resolved; hand it to the first sync so it does
            // not look it up again from the folder catalog.
            if (current) await traceBoot('sessionWorkbench.projectNavigation', () => this.openResource(folderBrowserPath(current.path)));
        }
        if (!this.active) {
            if (this.projects) this.showWelcome();
            else this.message('选择一个会话，或新建会话');
        }
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
    private updateRemoteAvailability(): void {
        const path = this.active;
        void this.applyRemoteAvailability(path).catch(error => this.report(error));
    }
    private async applyRemoteAvailability(path: string | null): Promise<void> {
        if (!this.projects?.remoteMounts) return;
        const target = path && !path.startsWith('draft:') ? resolveBrowserTarget(parseSessionRoute(path).path) : undefined;
        const folder = target?.kind === 'project-files' ? target.folder : target?.kind === 'files'
            ? (await this.repository.getManifest(target.sessionId)).folder : undefined;
        const project = folder ? await this.projects.forFolder(folder) : undefined;
        if (this.closed || path !== this.active) return;
        const offline = !!project && this.projects.remoteMounts.projectOffline(project.project.id);
        this.container.inert = offline;
        this.container.classList.toggle('project-workbench--offline', offline);
        this.container.setAttribute('aria-disabled', String(offline));
    }

    private scheduleRefresh(source: string): void {
        if (this.closed || !this.visible) return;
        this.refreshSources.add(source);
        if (this.refreshTimer) return;
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = undefined;
            this.refresh();
        }, 120);
    }
    private refresh(): void {
        if (this.closed || !this.visible || this.refreshQueued) return;
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
            if (this.closed || !this.visible) return;
            this.browser?.invalidateNavigation();
            await this.sidebarUI?.refresh();
            if (!this.visible || this.closed) return;
            await this.projectNavigation?.refresh(); this.updateRemoteAvailability();
            if (!this.visible || this.closed) return;
            await this.syncBranchRoute();
            for (const id of this.waiting) this.sidebarUI?.setNodeAttention(await this.sessionPath(id), t('project.waitingInput'));
            if (this.active?.startsWith('/')) {
                const target = resolveBrowserTarget(this.active);
                if (target.kind === 'task') await this.showTask(this.active);
                else if (target.kind === 'folder' || target.kind === 'tasks' || ((target.kind === 'files' || target.kind === 'project-files') && !this.editor && !this.previewCleanup)) await this.showDirectory(this.active);
            }
        }).catch(error => this.report(error));
    }
    private message(text: string): void {
        const node = document.createElement('div'); node.className = 'mm-placeholder'; node.textContent = text;
        this.tabs.content.replaceChildren(node);
    }
    private report(error: unknown): void {
        if (this.closed) return;
        // View errors only name the operation; the reason a user can act on is the cause.
        const text = describeErrorReason(error);
        if (!this.editor && !this.previewCleanup) this.message(text);
        else {
            const notice = document.createElement('div'); notice.className = 'session-detail__error';
            notice.setAttribute('role', 'alert'); notice.textContent = text; this.tabs.content.append(notice);
        }
    }
    /** Stale bookmarks must not abort the entire application bootstrap. */
    async restoreResource(resourceId: string): Promise<void> {
        try { await this.openResource(resourceId); }
        catch (error) {
            if (!(error instanceof URIError) && !(error instanceof FSError && ['EINVAL', 'ENOENT'].includes(error.code))) throw error;
            if (!this.editor && !this.previewCleanup) { this.active = null; this.activeBranch = undefined; }
            this.report(new Error(t('project.error.staleRoute')));
            this.onSelect(this.getActiveResourceId() ?? '', 'replace');
        }
    }
    private visible = true;
    private readonly viewLoads = new LatestViewLoad();
    private pendingTarget?: { id: string; options: OpenResourceOptions };
    private readonly readCleanup = new Set<Promise<void>>();
    private cancelViewLoad(): void {
        this.viewLoads.cancel();
        ++this.fileNavigationRevision;
        ++this.taskRefresh;
        this.projectNavigation?.cancelPending();
        this.sidebarUI?.cancelPendingSelection?.();
    }
    async setVisible(visible: boolean): Promise<void> {
        if (this.visible === visible || this.closed) return;
        this.visible = visible;
        this.sidebarUI?.setVisible?.(visible);
        if (!visible) {
            ++this.openIntent;
            this.cancelViewLoad();
            this.editor?.cancelPendingRender?.();
            if (this.refreshTimer) { clearTimeout(this.refreshTimer); this.refreshTimer = undefined; }
            try { await Promise.all(this.tabs.values().map(tab => tab.value?.editor?.flushPendingSave?.())); }
            catch (error) { this.report(error); throw error; }
        } else {
            const pending = this.pendingTarget;
            if (pending) await this.openResource(pending.id, pending.options);
            this.refresh();
        }
    }
    private finishReads(cleanup: Promise<void>): void {
        const tracked = cleanup.catch(error => this.report(error));
        this.readCleanup.add(tracked);
        void tracked.finally(() => this.readCleanup.delete(tracked));
    }
    private openIntent = 0;
    async openResource(resourceId: string, options: OpenResourceOptions = {}): Promise<void> {
        const intent = ++this.openIntent;
        const current = () => intent === this.openIntent && !this.closed;
        if (resourceId.startsWith('draft:') && this.projects) {
            const project = await this.projects.get(resourceId.slice(6));
            const folder = await this.projects.sessionFolder(project);
            if (!current()) return;
            return this.startSessionDraft(folderBrowserPath(folder));
        }
        const route = parseSessionRoute(resourceId);
        if (!isFlowPath(route.path) && await this.openFavorite(resourceId, route.path, options, current)) return;
        if (this.projects?.remoteMounts && !isFlowPath(route.path)) {
            const target = resolveBrowserTarget(route.path);
            const folder = browserTargetFolder(target, route.path,
                'sessionId' in target ? (await this.repository.getManifest(target.sessionId)).folder : undefined);
            const project = await this.projects.forFolder(folder);
            if (project && (target.kind === 'project-files' || target.kind === 'files')) {
                const remote = this.projects.remoteMounts;
                // An unprobed mount must be resolved now: a stale status would otherwise either
                // block a reachable project or let an unreachable read fail the open.
                if (remote.list(project.project.id).some(mount => remote.status(mount.mountId) !== 'online'))
                    await remote.checkConnections(project.project.id, { timeoutMs: 3000 });
                if (!current()) return;
                if (remote.projectOffline(project.project.id)) {
                    // An unavailable remote project disables its own view; it must never abort
                    // bootstrap or navigation, so report the state and stay on the disabled workbench.
                    this.container.inert = true;
                    this.container.classList.add('project-workbench--offline');
                    this.container.setAttribute('aria-disabled', 'true');
                    if (this.editor || this.previewCleanup) this.report(new Error(t('remote.projectOffline')));
                    else this.message(t('remote.projectOffline'));
                    return;
                }
            }
            if (!current()) return;
            this.container.inert = false; this.container.classList.remove('project-workbench--offline'); this.container.setAttribute('aria-disabled', 'false');
        }
        if (!current()) return;
        let path = route.path;
        if (isFlowPath(path)) {
            return Promise.resolve(this.hostContext?.navigate?.({ target: 'flows',
                ...(path === '/@flows' ? {} : { resourceId: path.slice('/@flows'.length) }) }));
        }
        this.cancelViewLoad();
        const load = this.viewLoads.begin();
        this.pendingTarget = { id: resourceId, options };
        if (!this.visible) this.viewLoads.cancel();
        const branch = options.branch ?? route.branch;
        const target = resolveBrowserTarget(path);
        const id = target.kind === 'session' ? target.sessionId : path;
        const operation = this.tail.then(async () => {
            if (this.closed) throw new Error('Session workspace closed');
            load.check();
            if (id === this.active && !options.reload && (branch === undefined || branch === this.activeBranch)) {
                if (target.kind === 'project-files') this.scheduleFileNavigation(path, options.fileNavigation);
                return;
            }
            if (target.kind === 'favorite') throw new Error('Favorite navigation was not resolved');
            const openingManifest = 'sessionId' in target ? await load.read(() => this.sessions.get(target.sessionId)) : undefined;
            load.check();
            const tabId = id;
            const old = this.tabs.current;
            if (old?.value && !old.value.editor && !old.value.previewCleanup && old.id !== id && id.startsWith(old.id + '/')) this.tabs.keep(old.id);
            await this.leaveEditor(); load.check();
            const existing = this.tabs.get(tabId);
            if (existing?.value && !options.reload && target.kind !== 'task' && target.kind !== 'tasks' && (target.kind !== 'session' || existing.value.branch === (branch ?? openingManifest!.currentBranch ?? 'main'))) {
                this.tabs.activate(tabId); this.restoreEditor(existing.value);
                await refreshDirectoryList(existing.panel); load.check();
                const navigationPath = openingManifest ? `${folderBrowserPath(openingManifest.folder)}/${openingManifest.id}` : path;
                await this.projectNavigation?.sync(navigationPath, { reveal: true, preserveProject: true }); load.check();
                this.onSelect(this.getActiveResourceId()!); return;
            }
            if (existing?.value) await this.tabs.close(tabId, false);
            await this.tabs.open(tabId, path.split('/').pop() || t('project.workspace'), target.kind !== 'session'); load.check();
            if (target.kind === 'session') this.tabs.setIcon(tabId, ENTITY_ICONS.chat);
            if (target.kind === 'folder' || target.kind === 'favorites') {
                this.active = id;
                this.activeBranch = undefined;
                await load.read(async () => this.projectNavigation?.sync(path, { reveal: true, preserveProject: options.preserveProject })); load.check();
                await this.showDirectory(path);
                this.onSelect(id);
                this.selectionSync = path;
                try { await this.sidebarUI?.selectPath(path); } finally { this.selectionSync = undefined; }
                return;
            }
            if (target.kind === 'project-files') {
                await this.openProjectFile(path, target, load); load.check();
                if (this.closed) throw new Error('Session workspace closed');
                this.active = path; this.activeBranch = undefined; this.onSelect(path); this.scheduleFileNavigation(path, options.fileNavigation); return;
            }
            const manifest = openingManifest!;
            const suffix = target.kind === 'session' ? '' : target.kind === 'files' ? '/files' + (target.path === '/' ? '' : target.path)
                : target.kind === 'tasks' ? '/tasks' : '/tasks/' + target.taskId;
            path = `${folderBrowserPath(manifest.folder)}/${target.sessionId}${suffix}`;
            await load.read(async () => this.projectNavigation?.sync(path, { preserveProject: true })); load.check();
            if (target.kind === 'session' || target.kind === 'files') {
                const cwd = target.kind === 'session' ? undefined : target.path.slice(0, target.path.lastIndexOf('/')) || '/';
                let acquired: FileSystemContextOwner | undefined;
                let assets: FileSystemView | undefined;
                let editor: IEditor | undefined;
                let previewCleanup: (() => void) | undefined;
                let mount: HTMLElement | undefined;
                try {
                    const context = await load.read(async () => acquired = await this.files.acquireFiles(target.sessionId, cwd));
                    load.check();
                    mount = await this.editorMount(manifest.folder, target.kind === 'session' ? manifest.id : undefined);
                    load.check();
                    const fileNode = target.kind === 'files' ? await load.read(() => context.context.fs.driver.getNode(target.path)) : undefined;
                    if (fileNode) this.tabs.setIcon(tabId, this.sidebarUI!.getResourceIcon(fileNode));
                    if (fileNode?.type === 'directory') {
                        await context.release(); acquired = undefined;
                        load.check(); await this.showDirectory(path);
                    } else if (target.kind === 'session') {
                        load.check();
                        assets = createFileSystemView({ viewId: `editor-attachments:${target.sessionId}`, mounts: [{ mountId: 'attachments', at: '/', root: '/attachments', fs: context.context.fs, access: 'rw' }] });
                        const project = await this.projects?.forFolder(manifest.folder);
                        editor = await load.read(async () => editor = await this.factory(mount!, {
                            initialInputState: options.initialInputState,
                            resolveSubmission: project ? () => this.projects!.drafts.submissionForSession(project.project.id, target.sessionId) : undefined,
                            target: { kind: 'session', sessionId: target.sessionId, branch: branch ?? manifest.currentBranch ?? 'main' }, files: context.context, assets, title: manifest.title,
                            hostContext: { ...this.hostContext!, directoryCommands: this.directoryMounts ? {
                                workspaceReadOnly: (await this.directoryMounts.fixedWorkspace(target.sessionId)) !== undefined,
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
                            } : undefined, toggleSidebar: () => this.sidebarUI?.toggleSidebar() } }));
                    } else {
                        let revision: string | undefined;
                        const bytes = await load.read(() => context.context.fs.driver.readContent(target.path, { encoding: 'binary', signal: load.signal, onRevision: value => { revision = value; } }));
                        load.check();
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
                            editor = await load.read(async () => editor = await this.fileFactory(mount!, { ...fileContentFormat(target.path), target: { kind: 'file', path: target.path }, files: context.context,
                                initialContent: content, signal: load.signal, title: target.path.split('/').pop(), readOnly,
                                hostContext: { chatFromFile: this.hostContext?.chatFromFile
                                    ? reference => this.hostContext!.chatFromFile!(reference, { sessionId: target.sessionId }) : undefined,
                                    openFile: async (file, anchor) => this.openLinkedFile((await this.sessionPath(target.sessionId)) + '/files' + file, anchor),
                                    toggleSidebar: () => this.sidebarUI?.toggleSidebar(), navigate: request => this.hostContext?.navigate(request) ?? Promise.resolve(),
                                    saveContent: readOnly ? undefined : async (_path, text) => {
                                        // A failed write must never look like a successful save: the
                                        // editor keeps its dirty state, and the user is told now.
                                        try { await context.context.fs.driver.writeContent(target.path, text, { ifRevision: revision, onRevision: value => { revision = value; } }); }
                                        catch (error) { const failure = localizeRemoteWriteError(error); this.report(failure); throw failure; }
                                        this.refresh();
                                    } },
                            }));
                        }
                    }
                    load.check();
                    if (this.closed) throw new Error('Session workspace closed');
                    if (editor || previewCleanup) {
                        this.editor = editor; this.context = context; this.assets = assets; this.previewCleanup = previewCleanup;
                        // L4: an open file activates Skills whose globs match it.
                        if (target.kind === 'files') this.mountEditorSkills(target.sessionId, target.path);
                    }
                } catch (error) {
                    mount?.remove();
                    const cleanup = load.drain().then(async () => {
                        try { previewCleanup?.(); await editor?.destroy(); }
                        finally { await Promise.allSettled([assets?.dispose(), acquired?.release()]); }
                    });
                    if (error instanceof ViewLoadCancelled) this.finishReads(cleanup); else await cleanup;
                    throw error;
                }
            } else if (target.kind === 'tasks') await this.showDirectory(path);
            else await this.showTask(path);
            load.check();
            if (this.closed) throw new Error('Session workspace closed');
            this.active = id;
            this.activeBranch = target.kind === 'session' ? branch ?? manifest.currentBranch ?? 'main' : undefined;
            this.onSelect(this.getActiveResourceId()!);
            this.selectionSync = path;
            try { await this.sidebarUI?.selectPath(path); } finally { this.selectionSync = undefined; }
        });
        const result = operation.then(() => {
            if (this.viewLoads.isCurrent(load) && this.tabs.current) {
                this.pendingTarget = undefined;
                this.retainEditor(this.viewLoads.detach(load));
            }
        }).catch(error => {
            if (this.viewLoads.isCurrent(load) && error instanceof FSError
                && (error as FSError & { reason?: string }).reason === 'PROJECT_ROOT_OVERLAP') {
                this.showProjectAccessError(error, id);
                return;
            }
            if (!(error instanceof ViewLoadCancelled)) {
                if (!this.editor && this.tabs.current?.value) this.restoreEditor(this.tabs.current.value);
                throw error;
            }
            if (this.closed) throw new Error('Session workspace closed');
        }).finally(() => {
            if (load.signal.aborted) this.finishReads(load.drain());
            if (this.viewLoads.isCurrent(load)) this.pendingTarget = undefined;
        });
        this.tail = result.catch(() => {}); return result;
    }
    private showProjectAccessError(error: FSError, resourceId: string): void {
        const details = error as FSError & { projectId?: string; location?: unknown; conflictingProjects?: unknown };
        console.warn('[Project access] Root overlap', { resourceId, projectId: details.projectId,
            location: details.location, conflictingProjects: details.conflictingProjects });
        const panel = document.createElement('div'); panel.className = 'session-detail';
        const notice = document.createElement('p'); notice.setAttribute('role', 'alert');
        notice.dataset.projectAccessError = ''; notice.textContent = error.message;
        panel.append(notice); this.tabs.content.replaceChildren(panel);
        this.active = resourceId; this.activeBranch = undefined;
        this.onSelect(resourceId);
    }
    private async syncBranchRoute(): Promise<void> {
        // Serialize reconciliation with navigation so a stale read cannot close a newer editor.
        const operation = this.tail.then(async () => {
            if (this.closed || !this.visible || !this.active) return;
            const id = this.active; if (id.startsWith('draft:')) return;
            const target = resolveBrowserTarget(id.startsWith('/') ? id : '/' + id);
            if (!('sessionId' in target)) return;
            const manifest = await this.sessions.get(target.sessionId).catch(async error => {
                if (!this.visible || this.closed) return undefined;
                if (error?.code !== 'ENOENT') throw error;
                if (this.tabs.current) await this.tabs.close(this.tabs.current.id, false);
                else await this.closeEditor();
                this.message('选择一个会话，或新建会话');
                this.onSelect('', 'replace');
                return undefined;
            });
            if (this.closed || !this.visible || !manifest || this.activeBranch === undefined || !this.editor) return;
            this.familyActions?.updateMetadata(manifest);
            const current = manifest.currentBranch ?? 'main';
            if (current !== this.activeBranch) {
                this.activeBranch = current;
                const tab = this.tabs.current;
                if (tab?.value) { tab.value.branch = current; }
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
            const manifest = await this.sessions.get(sessionId);
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
        await this.sidebarUI?.expandPath(path);
        const nodes = await this.navigationFiles!.driver.getChildren(path);
        if (this.closed || generation !== this.taskRefresh) return;
        const panel = document.createElement('div'); panel.className = 'session-detail';
        const heading = document.createElement('h2');
        const directoryNode = await this.navigationFiles!.driver.getNode(path);
        heading.textContent = path === '/' ? t('workbench.allProjects') : directoryNode ? directoryEntryName(directoryNode) : t('workbench.allProjects');
        if (this.closed || generation !== this.taskRefresh) return;
        panel.append(heading);
        if (this.projects && target.kind === 'folder') {
            const project = await this.projects.forFolder(folderPathFromBrowserPath(path));
            if (this.closed || generation !== this.taskRefresh) return;
            if (project) {
                const directory = document.createElement('p'); directory.className = 'project-workbench__directory';
                directory.textContent = project.project.directory.startsWith('host:') ? project.project.directory.slice(5) : t('project.managedDirectory'); panel.append(directory);
                const create = this.actionButton(panel, t('project.createSession'), () => this.startSessionDraft(path));
                create.disabled = !!this.projects.remoteMounts?.projectOffline(project.project.id);
                if (create.disabled) create.title = t('remote.projectOffline');
                const remote = this.projects.remoteMounts?.list(project.project.id).find(mount => mount.at === '/');
                if (remote?.connectionId) directory.textContent = `${this.projects.remoteMounts!.connection(remote.connectionId).name}: /${remote.alias}${remote.root === '/' ? '' : remote.root}`;
            }
        }
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
        const parent = path.slice(0, path.lastIndexOf('/')) || '/';
        const row = this.sidebarUI?.getNode(path);
        const writable = (target.kind === 'project-files' || target.kind === 'files') && !!row
            && allowsRowAction('create-in-folder-session', false, row) && !(await this.navigationFiles!.capabilitiesAt(path)).readonly;
        const list = createDirectoryList({ title: heading.textContent || t('project.workspace'), path: directoryPathLabel(path, heading.textContent),
            entries: nodes.map(node => ({ id: node.path, name: directoryEntryName(node), type: resolveBrowserTarget(node.path).kind === 'session' ? 'session' : node.type,
                icon: this.sidebarUI!.getResourceIcon(node), created: node.createdAt, modified: node.modifiedAt, size: node.type === 'file' ? node.size : undefined,
                disabled: node.metadata._disabled === true, description: String(node.metadata.navigationDescription ?? '') })),
            open: id => { void this.openResource(id).catch(error => this.report(error)); },
            parent: path === '/' ? undefined : () => { void this.openResource(parent).catch(error => this.report(error)); },
            refresh: () => this.directoryEntries(path),
            contextMenu: (event, id) => { void this.sidebarUI?.showItemMenu(event, id).catch(error => this.report(error)); },
            select: ids => this.sidebarUI?.setSelection(ids),
            selectedIds: () => this.sidebarUI?.getSnapshot().selectedIds ?? [],
            bulkActions: this.sidebarUI && (target.kind === 'project-files' || target.kind === 'files') ? directoryBulkActions(this.sidebarUI) : undefined,
            favorite: this.projects ? this.directoryFavorites() : undefined,
            actions: writable ? [
                { label: t('project.createFile'), icon: FILE_BROWSER_ICONS.addFile, run: () => { void this.createDirectoryEntry(path, 'file').catch(error => this.report(error)); } },
                { label: t('project.createFolder'), icon: FILE_BROWSER_ICONS.addFolder, run: () => { void this.createDirectoryEntry(path, 'directory').catch(error => this.report(error)); } },
            ] : undefined });
        heading.remove(); panel.append(list); this.tabs.title(this.tabs.current!.id, list.querySelector('h2')!.textContent!);
        if (this.sidebarUI) this.tabs.current!.subscriptions.push(watchDirectorySelection(panel, this.sidebarUI));
        this.tabs.setIcon(this.tabs.current!.id, this.sidebarUI?.getNode(path)?.icon ?? FILE_ICONS.folder);
        if (!this.closed) this.tabs.content.replaceChildren(panel);
        if (this.navigationFiles?.on) this.tabs.current!.subscriptions.push(watchDirectoryList(this.navigationFiles, panel, error => this.report(error)));
    }
    private async directoryEntries(path: string) {
        const nodes = await this.navigationFiles!.driver.getChildren(path);
        await this.sidebarUI?.refresh(); await this.sidebarUI?.expandPath(path);
        return nodes.map(node => ({ id: node.path, name: directoryEntryName(node), type: resolveBrowserTarget(node.path).kind === 'session' ? 'session' : node.type,
            icon: this.sidebarUI!.getResourceIcon(node), created: node.createdAt, modified: node.modifiedAt, size: node.type === 'file' ? node.size : undefined,
            disabled: node.metadata._disabled === true, description: String(node.metadata.navigationDescription ?? '') }));
    }
    private directoryFavorites() {
        const favorite = projectFavoriteAction(this.projects!, this.repository), cache = new Map<string, boolean>();
        return { state: (id: string) => { const node = this.sidebarUI?.getNode(id); return cache.get(id) ?? (node ? favorite.state(node) : undefined); },
            toggle: async (id: string) => { const node = this.sidebarUI?.getNode(id); if (node) { const before = cache.get(id) ?? favorite.state(node); await favorite.toggle(node); cache.set(id, !before); } } };
    }
    private async createDirectoryEntry(path: string, type: 'file' | 'directory'): Promise<void> {
        await showNameDialog(t(type === 'file' ? 'project.createFile' : 'project.createFolder'), t('project.newFileName'), this.dialogs.signal, async name => {
            const driver = this.navigationFiles!.driver;
            if (type === 'file') await driver.createFile({ parentPath: path, name, content: '' });
            else await driver.createDirectory({ parentPath: path, name });
            await this.sidebarUI?.refresh();
            await this.openResource(path, { reload: true });
        });
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
        this.tabs.content.replaceChildren(panel);
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
        this.tabs.content.replaceChildren(panel);
    }
    private async exportSelection(context: VFSToolbarContext): Promise<void> {
        if (!context.selectedIds.length) throw new Error(t('vfs.toolbar.selectExport'));
        const archive = await new WorkbenchArchiveExporter(this.projects!, this.repository).export(await Promise.all(context.selectedIds.map(path => archiveTarget(path, this.projects!))));
        if (!this.closed) downloadArchive(JSON.stringify(archive, null, 2));
    }
    private async importSelection(context: VFSToolbarContext): Promise<void> {
        const path = context.selectedIds[0] ?? context.parentPath ?? context.activeId ?? '/';
        const file = await chooseArchive(this.dialogs.signal);
        if (!file || this.closed) return;
        const content = await file.text();
        if (this.closed) return;
        const paths = await new WorkbenchArchiveImporter(this.projects!, this.lifecycle, this.repository).import(content, await archiveTarget(path, this.projects!));
        if (this.closed) return;
        await this.sidebarUI?.refresh();
        if (paths[0]) await this.openResource(await archiveTargetPath(paths[0], this.projects!));
    }
    private async exportSessionItem(item: { path: string; type: string }): Promise<{ name: string; content: string; mimeType: string } | null> {
        const target = resolveBrowserTarget(item.path);
        if (target.kind !== 'session') return null;
        return exportSessionBundle(this.repository, target.sessionId);
    }

    private async sessionPath(id: string): Promise<string> {
        const manifest = await this.sessions.get(id);
        return `${folderBrowserPath(manifest.folder)}/${id}`;
    }
    private fileNavigation: Promise<void> = Promise.resolve();
    private fileNavigationRevision = 0;
    /** File content is ready before optional navigation I/O; stale work cannot select a newer route. */
    private scheduleFileNavigation(path: string, mode?: ProjectFileView): void {
        const revision = ++this.fileNavigationRevision;
        const current = () => !this.closed && this.visible && revision === this.fileNavigationRevision && this.active === path;
        this.fileNavigation = this.fileNavigation.then(async () => {
            if (!current()) return;
            this.selectionSync = path;
            try {
                await traceBoot('projectFile.navigation', async () => this.projectNavigation?.sync(path, { reveal: true, fileView: mode, preserveProject: true }));
                if (current() && mode !== 'preserve') await this.sidebarUI?.selectPath(path);
            } finally { if (this.selectionSync === path) this.selectionSync = undefined; }
        }).catch(error => { if (current()) this.report(error); });
    }
    /**
     * Follow a favorite row to its live resource. Returns false when the route is not a
     * favorite, so the caller keeps handling it as a normal navigation target.
     */
    private async openFavorite(resourceId: string, routePath: string, options: OpenResourceOptions, current: () => boolean): Promise<boolean> {
        const projects = this.projects;
        const favorite = projects && resolveBrowserTarget(routePath);
        if (!projects || favorite?.kind !== 'favorite') return false;
        const resolved = await resolveProjectFavorite(projects, this.repository, favorite.folder, favorite.favoriteId);
        if (!current()) return true;
        await this.openResource(resolved.path, { ...options, fileNavigation: fileViewFor(resolved.kind) });
        // The resolved file is now active; keep the favorite row selected instead of its target.
        if (resolved.kind === 'file' && this.active === resolved.path) await this.selectPath(resourceId);
        return true;
    }
    private async selectPath(path: string): Promise<void> {
        this.selectionSync = path;
        try { await this.sidebarUI?.selectPath(path); } finally { this.selectionSync = undefined; }
    }
    private async creationFolder(parent?: string | null): Promise<string | null> {
        const root = this.sidebarUI?.getContentRoot?.();
        const selected = this.active?.startsWith('/') ? this.active : this.sidebarUI?.getActiveSession()?.id;
        const draftProject = parent == null && this.active?.startsWith('draft:') && this.projects
            ? await this.projects.get(this.active.slice(6)) : undefined;
        const path = parent ?? (draftProject ? folderBrowserPath(draftProject.path) : undefined)
            ?? (root && selected?.startsWith(root + '/') ? selected : root) ?? selected ?? this.active;
        let folder = path ? folderPathFromBrowserPath(path) : null;
        if (path && !isFlowPath(path)) {
            const target = resolveBrowserTarget(path.startsWith('/') ? path : '/' + path);
            if (target.kind === 'session') folder = (await this.sessions.get(target.sessionId)).folder ?? null;
        }
        if (!this.projects) return folder;
        const project = await this.projects.forFolder(folder);
        if (!project) throw new Error(t('project.selectForSession'));
        if (this.projects.remoteMounts?.projectOffline(project.project.id)) throw new Error(t('remote.projectOffline'));
        return folder && folder.startsWith(project.path + '/') ? folder : this.projects.sessionFolder(project);
    }
    private actionButton(parent: HTMLElement, label: string, action: () => Promise<unknown>): HTMLButtonElement {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
        button.onclick = () => { button.disabled = true; void action().catch(error => this.report(error)).finally(() => { button.disabled = false; }); };
        parent.append(button); return button;
    }
    private async removeSession(id: string): Promise<void> {
        await this.lifecycle.deleteSession(id);
        for (const tab of this.tabs.values()) if (tab.value?.active === id) await this.tabs.close(tab.id);
        await this.sidebarUI?.refresh();
        await this.projectNavigation?.refresh();
    }
    private installProjectNavigation(): void {
        this.sidebar.classList.add('project-workbench');
        this.familyActions = new SessionFamilyActions(this.projects!.sessions, this.dialogs.signal, {
            open: id => this.openResource(id, { reload: this.active === id }), child: id => this.createChild(id),
            remove: id => this.removeSession(id),
            changed: async () => { await this.sidebarUI?.refresh(); await this.projectNavigation?.refresh(); },
            showFamily: () => this.projectNavigation?.showContent(),
            report: error => this.report(error),
        });
        this.projectNavigation = new ProjectNavigation(this.projects!, () => this.sidebarUI, {
            projectRenamed: (from, to) => this.remapProjectRoutes(folderBrowserPath(from.path), folderBrowserPath(to.path), to.name),
            projectMenu: async (event, project) => {
                await this.syncMenu.refresh(project.project.id);
                if (!this.dialogs.signal.aborted) await this.sidebarUI?.showItemMenu(event, folderBrowserPath(project.path));
            },
            projectsChanged: projects => { for (const project of projects) void this.syncMenu.refresh(project.project.id).catch(error => this.report(error)); },
            navigate: path => this.openResource(path),
            createSession: path => this.startSessionDraft(path), createChild: id => this.createChild(id),
            retryDeletions: async () => {
                for (const entry of await this.repository.pendingSessionDeletions()) await this.lifecycle.deleteSession(entry.id);
                await this.sidebarUI?.refresh(); await this.projectNavigation?.refresh();
            },
            contentChanged: () => {}, importItems: context => this.importSelection(context), exportItems: context => this.exportSelection(context),
            createProject: path => this.createProject(path), report: error => this.report(error),
        });
    }
    private familyMenu(id: string) {
        const run = (action: () => Promise<unknown>) => () => { void action().catch(error => this.report(error)); };
        return [
            { id: 'new-child', label: t('project.newChild'), onClick: run(() => this.createChild(id)) },
            { id: 'move-under', label: t('project.moveUnder'), onClick: run(() => this.familyActions!.move(id)) },
            { id: 'promote-session', label: t('project.promoteSession'), onClick: run(() => this.familyActions!.promote(id)) },
            { id: 'delete-session-only', label: t('project.deleteSessionOnly'), onClick: run(() => this.familyActions!.remove(id)) },
        ];
    }
    async createChild(parentSessionId: string): Promise<string> {
        if (!this.projects) throw new Error('Projects unavailable');
        const parent = await this.sessions.get(parentSessionId);
        const project = await this.projects.forFolder(parent.folder);
        if (!project) throw new Error(t('project.selectForSession'));
        if (this.projects.remoteMounts?.projectOffline(project.project.id)) throw new Error(t('remote.projectOffline'));
        const id = await this.projects.sessions.createChild(parentSessionId);
        await this.sidebarUI?.refresh(); await this.openResource(id); this.projectNavigation?.showContent(); this.editor?.focus?.(); return id;
    }
    private async createProject(selected?: string | null): Promise<void> {
        const path = selected ?? this.sidebarUI?.getActiveSession()?.id ?? '/';
        const folder = folderPathFromBrowserPath(path);
        const current = await this.projects!.forFolder(folder);
        const parent = current ? current.parentPath : folder;
        await showProjectDialog(this.projects!, parent, this.dialogs.signal, async created => {
            await this.sidebarUI?.refresh(); await this.openResource(folderBrowserPath(created));
        });
    }
    private showWelcome(): void {
        const panel = document.createElement('div'); panel.className = 'mm-placeholder project-workbench__welcome';
        const mark = document.createElement('span'); mark.className = 'project-workbench__mark'; mark.textContent = 'X1';
        const title = document.createElement('h1'); title.textContent = t('project.welcome');
        const hint = document.createElement('p'); hint.textContent = t('project.welcomeHint');
        panel.append(mark, title, hint);
        if (this.projects) this.actionButton(panel, t('project.create'), () => this.createProject('/'));
        this.tabs.content.replaceChildren(panel);
    }
    private remapProjectRoutes(from: string, to: string, title: string): void {
        ++this.fileNavigationRevision;
        for (const tab of this.tabs.values()) {
            const next = remapProjectPath(tab.id, from, to);
            if (next !== tab.id) this.tabs.rename(tab.id, next, tab.id === from ? title : tab.title);
            if (tab.value?.active) tab.value.active = remapProjectPath(tab.value.active, from, to);
        }
        if (this.selectionSync) this.selectionSync = remapProjectPath(this.selectionSync, from, to);
        if (this.active) {
            const next = remapProjectPath(this.active, from, to);
            if (next !== this.active) { this.active = next; this.onSelect(this.getActiveResourceId() ?? '', 'replace'); }
        }
    }

    private async editorMount(folder?: string | null, sessionId?: string): Promise<HTMLElement> {
        const mount = document.createElement('div'); mount.className = 'session-editor-mount';
        const project = await this.projects?.forFolder(folder);
        this.tabs.content.replaceChildren();
        if (project) {
            const context = document.createElement('div'); context.className = 'project-workbench__context';
            context.textContent = t('project.current', { name: project.name });
            this.tabs.content.append(context);
        }
        if (sessionId) this.tabs.title(this.tabs.current!.id, (await this.sessions.get(sessionId)).title);
        if (sessionId && this.familyActions) this.tabs.content.append(await this.familyActions.header(await this.sessions.get(sessionId)));
        this.tabs.content.append(mount); return mount;
    }
    private async openProjectFile(_path: string, target: { folder: string; path: string }, load: ViewLoad): Promise<void> {
        if (!this.projects) throw new Error('Projects unavailable');
        const opened = await openProjectFileEditor(this.projects, target, load, {
            factory: this.fileFactory, mount: () => this.editorMount(target.folder),
            showBinary: (mount, path, bytes) => this.showBinary(mount, path, bytes),
            deferCleanup: cleanup => this.finishReads(cleanup),
            changed: () => this.refresh(),
            host: { chatFromFile: this.hostContext?.chatFromFile
                ? reference => this.hostContext!.chatFromFile!(reference, { projectFolder: target.folder }) : undefined,
                openFile: (file, anchor) => this.openLinkedFile(folderBrowserPath(target.folder) + '/@files' + projectRelativePath(file), anchor),
                toggleSidebar: () => this.sidebarUI?.toggleSidebar(),
                navigate: request => this.hostContext?.navigate(request) ?? Promise.resolve() },
        });
        if (!opened) { await this.showDirectory(_path); return; }
        this.editor = opened.editor; this.context = opened.context; this.previewCleanup = opened.previewCleanup;
        this.tabs.setIcon(this.tabs.current!.id, this.sidebarUI!.getResourceIcon(opened.node));
        this.tabs.title(this.tabs.current!.id, target.path.split('/').pop() || target.path);
        if (opened.editor) this.trackProjectFileRenames(opened.context.context.fs, target.folder, target.path);
    }

    private async openLinkedFile(path: string, anchor?: string): Promise<void> {
        await this.openResource(path);
        if (anchor) await this.editor?.navigateTo({ elementId: anchor });
    }

    private trackProjectFileRenames(fs: IFileSystem, folder: string, path: string): void {
        const editor = this.editor, tab = this.tabs.current!;
        const remap = (event: { payload: { nodes: { oldPath: string; newPath: string }[] } }) => {
            for (const { oldPath, newPath } of event.payload.nodes) {
                if (path !== oldPath && !path.startsWith(oldPath + '/')) continue;
                path = newPath + path.slice(oldPath.length);
                const filename = path.split('/').pop()!;
                editor?.updateNodeId?.(path);
                editor?.setTitle?.(buildRenamedFilename(filename, filename).title);
                const next = folderBrowserPath(folder) + '/@files' + projectRelativePath(path);
                const selected = this.tabs.current === tab;
                this.tabs.rename(tab.id, next, filename); if (tab.value) tab.value.active = next;
                if (selected) { this.active = next; if (this.visible) this.onSelect(next, 'replace'); }
                this.scheduleRefresh('file-rename');
            }
        };
        const stops = [fs.on('node:renamed', remap), fs.on('node:moved', remap), fs.on('node:deleted', event => {
            if (event.payload.requestedPaths.some(deleted => path === deleted || path.startsWith(deleted + '/')))
                void this.tabs.close(tab.id, false).catch(error => this.report(error));
        })];
        this.fileRenameCleanup = () => stops.forEach(stop => stop());
    }

    async startSessionDraft(parent?: string): Promise<void> {
        const folder = await this.creationFolder(parent);
        this.cancelViewLoad(); const load = this.viewLoads.begin();
        const work = this.tail.then(async () => {
            await this.leaveEditor(); load.check();
            this.container.inert = false; this.container.classList.remove('project-workbench--offline');
            const project = await this.projects?.forFolder(folder);
            load.check();
            if (!project || !this.projects || !folder) throw new Error('Project required for a draft');
            this.projectNavigation?.showDraft(project);
            const draftId = `draft:${project.project.id}`;
            const retained = this.tabs.get(draftId);
            await this.tabs.open(draftId, t('project.createSession'), false);
            this.tabs.setIcon(draftId, FILE_BROWSER_ICONS.newSession);
            if (retained?.value) { this.restoreEditor(retained.value); this.onSelect(draftId, 'replace'); return; }
            const mount = await this.editorMount(folder);
            const composer = await this.projects.drafts.open(project.project.id, folder);
            const draftOptions = createProjectDraftControls(composer, {
                check: async () => { load.check(); await this.creationFolder(folderBrowserPath(folder)); },
                open: async id => {
                    await Promise.all([this.openResource(id), this.sidebarUI?.refresh()]);
                    await this.tabs.close(draftId, false);
                    await this.selectPath(await this.sessionPath(id));
                    if (!this.editor) throw new Error('Session editor unavailable');
                    return this.editor;
                },
            });
            const editor = await this.factory(mount, { signal: load.signal, hostContext: this.hostContext, sessionDraft: draftOptions });
            try { load.check(); } catch (error) { await editor.destroy(); mount.remove(); throw error; }
            this.editor = editor; this.active = draftId; this.editor.focus?.();
            this.retainEditor(this.viewLoads.detach(load));
            this.onSelect(draftId, 'replace');
        });
        this.tail = work.catch(() => {}); await work;
    }

    async createResource(options: { title?: string; parentPath?: string | null; initialInputState?: { text?: string; agentId?: string } } = {}): Promise<string> {
        if (this.closed) throw new Error('Session workspace closed');
        const folder = await this.creationFolder(options.parentPath);
        const id = await this.sessions.create(options.title || formatDefaultFileTitle(), folder);
        const opening = this.openResource(id, { initialInputState: options.initialInputState });
        await Promise.all([opening, this.sidebarUI?.refresh()]);
        if (!this.closed && this.active === id) {
            // The editor can finish before its new sidebar entry is available.
            this.selectionSync = await this.sessionPath(id);
            try { await this.sidebarUI?.selectPath(this.selectionSync); } finally { this.selectionSync = undefined; }
        }
        return id;
    }
    getActiveResourceId(): string | null {
        return this.active && this.activeBranch !== undefined ? sessionRoute(this.active, this.activeBranch) : this.active;
    }
    setWaitingInput(id: string, waiting: boolean): void {
        waiting ? this.waiting.add(id) : this.waiting.delete(id);
        if (!this.visible || this.closed) return;
        void this.sessionPath(id).then(path => { if (!this.closed && this.visible) this.sidebarUI?.setNodeAttention(path, this.waiting.has(id) ? t('project.waitingInput') : undefined); }).catch(error => this.report(error));
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

    private clearEditorFields(): void {
        this.editor = undefined; this.context = undefined; this.assets = undefined; this.editorLease = undefined;
        this.previewCleanup = undefined; this.fileRenameCleanup = undefined; this.active = null; this.activeBranch = undefined;
    }
    private retainEditor(cancel?: () => void): void {
        const tab = this.tabs.current; if (!tab || tab.value) return;
        tab.value = { editor: this.editor, context: this.context, assets: this.assets, previewCleanup: this.previewCleanup,
            renameCleanup: this.fileRenameCleanup, active: this.active, branch: this.activeBranch, cancel, skills: this.openEditorTarget };
        this.tabs.bind(tab, this.editor);
    }
    private restoreEditor(value: RetainedEditor): void {
        this.editor = value.editor; this.context = value.context; this.assets = value.assets;
        this.previewCleanup = value.previewCleanup; this.fileRenameCleanup = value.renameCleanup;
        this.active = value.active; this.activeBranch = value.branch;
        this.familyActions?.activate(this.tabs.current?.panel.querySelector('.session-family__toolbar') ?? null);
        if (value.skills) this.mountEditorSkills(value.skills.sessionId, value.skills.path);
    }
    private async leaveEditor(): Promise<void> {
        if (this.tabs.current?.value) {
            await this.editor?.flushPendingSave?.();
            if (this.editor?.isDirty?.() && !this.editor.flushPendingSave) throw new Error(t('workbench.pending'));
            await this.unmountEditorSkills(); this.clearEditorFields();
        } else await this.closeEditor();
    }
    private async disposeTab(tab: WorkbenchTab<RetainedEditor>): Promise<void> {
        const value = tab.value; if (!value) return;
        await value.editor?.flushPendingSave?.();
        if (value.editor?.isDirty?.() && !value.editor.flushPendingSave) throw new Error(t('workbench.pending'));
        value.lease ??= new EditorLease(value.editor, async () => {
            value.previewCleanup?.(); value.renameCleanup?.(); value.cancel?.();
            this.familyActions?.release(tab.panel.querySelector('.session-family__toolbar'));
            if (this.openEditorTarget && value.skills?.sessionId === this.openEditorTarget.sessionId && value.skills.path === this.openEditorTarget.path) await this.unmountEditorSkills();
            await Promise.all([value.assets?.dispose(), value.context?.release()]);
        });
        await value.lease.dispose();
        if (this.tabs.current === tab) this.clearEditorFields();
    }

    private async closeEditor(): Promise<void> {
        if (!this.editorLease) {
            const editor = this.editor, assets = this.assets, context = this.context;
            this.editorLease = new EditorLease(editor, async () => {
                ++this.taskRefresh;
                this.previewCleanup?.(); this.previewCleanup = undefined;
                this.fileRenameCleanup?.(); this.fileRenameCleanup = undefined;
                await this.unmountEditorSkills();
                const results = await Promise.allSettled([assets?.dispose(), context?.release()]);
                const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
                if (errors.length) throw new AggregateError(errors, 'Editor resource cleanup failed');
            });
        }
        await this.editorLease.dispose();
        this.editorLease = undefined;
        this.editor = undefined; this.assets = undefined; this.context = undefined; this.active = null;
        this.activeBranch = undefined;
    }
    async destroy(): Promise<void> {
        ++this.openIntent;
        this.cancelViewLoad();
        this.closed = true; ++this.fileNavigationRevision; this.projectNavigation?.cancelPending();
        this.sidebarUI?.cancelPendingSelection?.(); this.dialogs.abort(); this.subscriptions.dispose();
        if (this.refreshTimer) { clearTimeout(this.refreshTimer); this.refreshTimer = undefined; }
        await Promise.all([this.tail, this.refreshTail]); await this.fileNavigation; await Promise.all(this.readCleanup);
        this.sidebarLayout.save(this.tabs.snapshot()); await this.tabs.destroy(); await this.closeEditor(); this.sidebarUI?.destroy(); this.sidebarLayout.destroy();
        if (this.projects?.remoteMounts) {
            this.container.inert = false;
            this.container.classList.remove('project-workbench--offline');
            this.container.removeAttribute('aria-disabled');
        }
        await this.navigationFiles?.dispose(); await this.browser?.dispose(); this.tabs.content.replaceChildren();
    }
}

/** Session and Task entries are virtual containers, not writable creation directories. */
function sessionCreationParent(path: string | null): string | null {
    if (!path) return null;
    if (isFlowPath(path)) return null;
    const target = resolveBrowserTarget(path);
    if (target.kind === 'folder' || target.kind === 'files' || target.kind === 'project-files') return path;
    const folders = path.split('/').filter(Boolean);
    const sessionIndex = folders.findIndex(segment => !segment.startsWith('folder:'));
    return sessionIndex > 0 ? '/' + folders.slice(0, sessionIndex).join('/') : null;
}

function isFlowPath(path: string): boolean { return path === '/@flows' || path.startsWith('/@flows/'); }
/** Persisted expansion can name routes this build no longer serves; drop those instead of failing boot. */
function isExpandableDirectory(path: string): boolean {
    if (isFlowPath(path)) return true;
    try { return resolveBrowserTarget(path).kind === 'folder'; } catch { return false; }
}
