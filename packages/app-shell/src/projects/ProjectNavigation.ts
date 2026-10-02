import { fileFirst, projectItems } from './navigation-policy';
import { t, FILE_BROWSER_ICONS } from '@itookit/common';
import { browserTargetFolder, folderBrowserPath, resolveBrowserTarget, type ProjectFolder, type ProjectNavigationSnapshot, type ProjectService } from '@itookit/app-core';
import type { VFSToolbarContext, VFSColumnsOptions, VFSNodeUI, VFSUIShell } from '@itookit/vfs-ui';
import { decorateButton } from '../workbench/controls';

interface Actions {
    createProject(path?: string | null): Promise<unknown>; createSession(path?: string): Promise<unknown>;
    createChild(id: string): Promise<unknown>; importItems(context: VFSToolbarContext): Promise<void>; exportItems(context: VFSToolbarContext): Promise<void>;
    report(error: unknown): void; retryDeletions(): Promise<void>;
    contentChanged(visible: boolean, family: boolean): void;
    navigate?(path: string): Promise<void>;
}
/** Compatibility hint: favorites may preserve selection while their file opens. */
export type ProjectFileView = 'preserve' | 'directory';
export interface ProjectNavigationOptions { reveal?: boolean; project?: ProjectFolder; draft?: boolean; fileView?: ProjectFileView }

/** Project context replaces the contents of one sidebar; file details belong to main tabs. */
export class ProjectNavigation {
    readonly header = document.createElement('div');
    readonly toolbarContainer = document.createElement('span');
    readonly options: Pick<VFSColumnsOptions, 'navigationAction' | 'navigationToolbarOptions'>;
    private readonly create = document.createElement('button');
    private readonly filesButton = document.createElement('button');
    private readonly selector = document.createElement('select');
    private readonly retry = document.createElement('button');
    private project?: ProjectFolder;
    private path = '/';
    private session?: string;
    private familyVisible = false;
    private family?: string;
    private draftActive = false;
    private revision = 0;
    private projectPaths = new Set<string>();
    private offlinePaths = new Set<string>();
    private readonly revealedFiles = new Set<string>();
    constructor(private readonly projects: ProjectService, private readonly ui: () => VFSUIShell | undefined, private readonly actions: Actions) {
        this.buildHeader();
        this.updateHeader([], 0);
        this.options = {
            navigationAction: { label: t('project.createSession'), icon: FILE_BROWSER_ICONS.newSession,
                active: path => this.draftActive && path === folderBrowserPath(this.project?.path), afterChildId: path => path + '/@files',
                visible: path => this.projectPaths.has(path), disabled: path => this.offlinePaths.has(path),
                run: async path => { await this.actions.createSession(path); } },
            navigationToolbarOptions: { directoryFirst: true, directoryLabel: t('vfs.toolbar.project'), fileLabel: t('vfs.toolbar.session'),
                hiddenActions: ['create-file', 'create-directory'], actions: {
                    'create-directory': context => this.actions.createProject(context.selectedIds[0] ?? context.parentPath).then(() => {}),
                    import: this.actions.importItems, export: this.actions.exportItems,
                } },
        };
    }
    private buildHeader(): void {
        this.header.className = 'workbench-project-navigation';
        this.button(this.create, t('project.createSession'), () => this.actions.createSession(folderBrowserPath(this.project?.path)));
        this.create.className = 'workbench-project-navigation__create';
        decorateButton(this.create, FILE_BROWSER_ICONS.newSession, t('project.createSession'), true);
        this.button(this.filesButton, t('project.files'), () => this.actions.navigate?.(folderBrowserPath(this.project?.path) + '/@files') ?? Promise.resolve());
        decorateButton(this.filesButton, FILE_BROWSER_ICONS.root, t('project.files'), true);
        this.button(this.retry, '', () => this.actions.retryDeletions()); this.retry.hidden = true;
        this.selector.setAttribute('aria-label', t('project.workspace'));
        this.selector.onchange = () => {
            if (this.selector.value === '@new-project') {
                this.selector.value = this.project ? folderBrowserPath(this.project.path) : '/';
                void this.actions.createProject('/').catch(this.actions.report);
            } else void this.actions.navigate?.(this.selector.value).catch(this.actions.report);
        };
        this.toolbarContainer.className = 'workbench-project-navigation__transfer';
        this.header.append(this.selector, this.filesButton, this.create, this.toolbarContainer, this.retry);
    }
    private button(button: HTMLButtonElement, label: string, action: () => Promise<unknown>): void {
        button.type = 'button'; button.textContent = label;
        button.onclick = () => { void action().catch(this.actions.report); };
    }
    cancelPending(): void { ++this.revision; }
    async sync(path: string, options: ProjectNavigationOptions = {}): Promise<void> {
        this.path = path; this.draftActive = options.draft ?? false;
        const target = resolveBrowserTarget(path); this.session = 'sessionId' in target ? target.sessionId : undefined;
        const revision = ++this.revision;
        const snapshot = await this.projects.sessions.navigation({ includeSessions: target.kind !== 'project-files' });
        if (revision === this.revision) await this.apply(snapshot, path, revision, options.project);
    }
    private async apply(snapshot: ProjectNavigationSnapshot, path: string, revision: number, resolved?: ProjectFolder): Promise<void> {
        const target = resolveBrowserTarget(path), manifest = 'sessionId' in target ? snapshot.sessions.find(item => item.id === target.sessionId) : undefined;
        const folder = browserTargetFolder(target, path, manifest?.folder);
        const project = resolved ?? await this.projects.forFolder(folder, snapshot.folders);
        const projects = await this.projects.list(snapshot.folders);
        if (revision !== this.revision) return;
        if (this.project?.project.id !== project?.project.id) this.familyVisible = false;
        const family = manifest ? snapshot.roots.get(manifest.id) : undefined;
        if (family !== this.family) this.familyVisible = false; this.family = family;
        this.project = project; this.path = path; this.session = manifest?.id;
        this.projectPaths = new Set(projects.map(item => folderBrowserPath(item.path)));
        this.offlinePaths = new Set(projects.filter(item => this.projects.remoteMounts?.projectOffline(item.project.id)).map(item => folderBrowserPath(item.path)));
        this.updateHeader(projects, snapshot.pending.length);
        this.ui()?.setTitle(project?.name ?? t('workbench.allProjects')); this.ui()?.refreshList();
        if (project) {
            await this.ui()?.expandPath(folderBrowserPath(project.path));
            if (revision !== this.revision) return;
            await this.ui()?.loadDirectories([folderBrowserPath(project.path) + '/folder:%40sessions']);
            const files = folderBrowserPath(project.path) + '/@files';
            if (!this.revealedFiles.has(files) && !this.offlinePaths.has(folderBrowserPath(project.path))) {
                await this.ui()?.expandPath(files); this.revealedFiles.add(files);
            }
        }
        if (revision === this.revision) this.ui()?.refreshList();
    }
    private updateHeader(projects: ProjectFolder[], pending: number): void {
        const project = this.project;
        this.create.hidden = !project; this.filesButton.hidden = !project;
        this.create.disabled = !!project && this.offlinePaths.has(folderBrowserPath(project.path));
        this.create.setAttribute('aria-current', this.draftActive ? 'page' : 'false');
        this.retry.hidden = !pending; this.retry.textContent = t('project.retryDeletion', { count: pending });
        this.selector.replaceChildren();
        const all = document.createElement('option'); all.value = '/'; all.textContent = t('workbench.allProjects'); this.selector.append(all);
        for (const item of projects) { const option = document.createElement('option'); option.value = folderBrowserPath(item.path); option.textContent = item.name; this.selector.append(option); }
        const create = document.createElement('option'); create.value = '@new-project'; create.textContent = t('project.create') + '…'; this.selector.append(create);
        this.selector.value = project ? folderBrowserPath(project.path) : '/';
    }
    navigationItems(items: VFSNodeUI[], query = ''): VFSNodeUI[] {
        const root = this.project ? findNode(items, folderBrowserPath(this.project.path)) : undefined;
        const nodes = projectItems(this.project ? root?.children ?? [] : items, query, this.familyVisible ? this.family : undefined);
        return nodes.sort((a, b) => fileFirst(a, b) ?? 0);
    }
    showContent(): void { this.familyVisible = !this.familyVisible; this.ui()?.refreshList(); }
    async refresh(): Promise<void> {
        const revision = ++this.revision;
        const snapshot = await this.projects.sessions.navigation({ includeSessions: resolveBrowserTarget(this.path).kind !== 'project-files' });
        if (revision !== this.revision) return;
        const manifest = this.session ? snapshot.sessions.find(item => item.id === this.session) : undefined;
        const path = this.session && !manifest ? folderBrowserPath(this.project?.path) : manifest ? `${folderBrowserPath(manifest.folder)}/${manifest.id}` : this.path;
        await this.apply(snapshot, path, revision);
    }
    currentProject(): ProjectFolder | undefined { return this.project; }
}
function findNode(items: VFSNodeUI[], id: string): VFSNodeUI | undefined {
    for (const node of items) {
        if (node.id === id) return node;
        const child = node.children && findNode(node.children, id); if (child) return child;
    }
}
