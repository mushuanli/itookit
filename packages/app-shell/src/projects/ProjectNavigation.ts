import { fileFirst, projectItems } from './navigation-policy';
import { remapProjectPath } from './project-paths';
import { t, FILE_BROWSER_ICONS, VFS_TOOLBAR_ICONS } from '@itookit/common';
import { browserTargetFolder, folderBrowserPath, resolveBrowserTarget, type ProjectFolder, type ProjectNavigationSnapshot, type ProjectService } from '@itookit/app-core';
import { ScopeSelector } from '@itookit/vfs-ui';
import type { VFSActionDefinition, VFSActionContext, VFSToolbarContext, VFSColumnsOptions, VFSNodeUI, VFSUIShell } from '@itookit/vfs-ui';
import { decorateButton } from '../workbench/controls';

interface Actions {
    projectRenamed?(from: ProjectFolder, to: ProjectFolder): void;
    projectMenu?(event: MouseEvent, project: ProjectFolder): Promise<void>;
    projectsChanged?(projects: ProjectFolder[]): void;
    createProject(path?: string | null): Promise<unknown>; createSession(path?: string): Promise<unknown>;
    createChild(id: string): Promise<unknown>; importItems(context: VFSToolbarContext): Promise<void>; exportItems(context: VFSToolbarContext): Promise<void>;
    report(error: unknown): void; retryDeletions(): Promise<void>;
    contentChanged(visible: boolean, family: boolean): void;
    navigate?(path: string): Promise<void>;
}
/** Compatibility hint: favorites may preserve selection while their file opens. */
export type ProjectFileView = 'preserve' | 'directory';
export interface ProjectNavigationOptions { reveal?: boolean; project?: ProjectFolder; preserveProject?: boolean; fileView?: ProjectFileView }

/** Project context replaces the contents of one sidebar; file details belong to main tabs. */
export class ProjectNavigation {
    readonly header = document.createElement('div');
    readonly toolbarContainer = document.createElement('span');
    readonly options: Pick<VFSColumnsOptions, 'navigationToolbarOptions'>;
    private readonly create = document.createElement('button');
    private readonly selector: ScopeSelector;
    private readonly retry = document.createElement('button');
    private readonly menu = document.createElement('button');
    private project?: ProjectFolder;
    private path = '/';
    private session?: string;
    private familyVisible = false;
    private family?: string;
    private draftActive = false;
    private revision = 0;
    private offlinePaths = new Set<string>();
    private readonly revealedFiles = new Set<string>();
    constructor(private readonly projects: ProjectService, private readonly ui: () => VFSUIShell | undefined, private readonly actions: Actions) {
        this.selector = new ScopeSelector({ label: t('project.workspace'), onError: actions.report,
            select: async value => {
                if (value === '@new-project') await actions.createProject('/');
                else await this.choose(value);
            } });
        this.buildHeader();
        this.updateHeader([], 0);
        this.options = {
            navigationToolbarOptions: { definitions: [
                this.transferAction('import', context => this.actions.importItems(context)),
                this.transferAction('export', context => this.actions.exportItems(context)),
            ] },
        };
    }
    private transferAction(id: 'import' | 'export', run: (context: VFSToolbarContext) => Promise<void>): VFSActionDefinition {
        return { id, label: t(`vfs.toolbar.${id}`), iconHTML: VFS_TOOLBAR_ICONS[id],
            placement: (context: VFSActionContext) => {
                if (context.origin === 'toolbar') return this.project ? 'hidden' : 'toolbar';
                return context.target?.metadata.custom.projectId ? 'menu' : 'hidden';
            },
            disabled: (context: VFSActionContext) => !!context.target?.metadata.custom.projectId
                && !!this.projects.remoteMounts?.projectOffline(String(context.target.metadata.custom.projectId)),
            run: (context: VFSActionContext) => run({ selectedIds: context.selectedIds, activeId: context.activeId, parentPath: context.parentPath }),
        };
    }
    private buildHeader(): void {
        this.header.className = 'workbench-project-navigation';
        this.button(this.create, t('project.createSession'), () => this.actions.createSession(folderBrowserPath(this.project?.path)));
        this.create.className = 'workbench-project-navigation__create';
        decorateButton(this.create, FILE_BROWSER_ICONS.newSession, t('project.createSession'), true);
        this.button(this.retry, '', () => this.actions.retryDeletions()); this.retry.hidden = true;
        this.menu.type = 'button'; decorateButton(this.menu, FILE_BROWSER_ICONS.more, t('project.sync.projectActions'), true);
        this.menu.onclick = () => {
            const rect = this.menu.getBoundingClientRect();
            this.showMenu(new MouseEvent('contextmenu', { clientX: rect.left, clientY: rect.bottom }));
        };
        this.selector.element.oncontextmenu = event => { if (this.project) { event.preventDefault(); this.showMenu(event); } };
        this.toolbarContainer.className = 'workbench-project-navigation__transfer';
        this.header.append(this.selector.element, this.create, this.toolbarContainer, this.menu, this.retry);
    }
    private async choose(path: string): Promise<void> {
        this.project = path === '/' ? undefined : await this.projects.forFolder(browserTargetFolder(resolveBrowserTarget(path), path));
        await this.sync(path, { preserveProject: true });
        await this.actions.navigate?.(path);
    }
    private showMenu(event: MouseEvent): void {
        const project = this.project;
        if (project) void this.actions.projectMenu?.(event, project).catch(this.actions.report);
    }
    private button(button: HTMLButtonElement, label: string, action: () => Promise<unknown>): void {
        button.type = 'button'; button.textContent = label;
        button.onclick = () => { void action().catch(this.actions.report); };
    }
    destroy(): void { this.cancelPending(); this.selector.destroy(); }
    cancelPending(): void { ++this.revision; }
    showDraft(project: ProjectFolder): void {
        this.cancelPending();
        this.session = undefined;
        this.draftActive = this.project?.project.id === project.project.id;
        this.create.setAttribute('aria-current', this.draftActive ? 'page' : 'false');
    }
    async sync(path: string, options: ProjectNavigationOptions = {}): Promise<void> {
        this.path = path; this.draftActive = false;
        const target = resolveBrowserTarget(path); this.session = 'sessionId' in target ? target.sessionId : undefined;
        const revision = ++this.revision;
        const snapshot = await this.projects.sessions.navigation({ includeSessions: target.kind !== 'project-files' });
        if (revision === this.revision) await this.apply(snapshot, path, revision, options.project, options.preserveProject);
    }
    private async apply(snapshot: ProjectNavigationSnapshot, path: string, revision: number, resolved?: ProjectFolder, preserveProject = false): Promise<void> {
        const target = resolveBrowserTarget(path), manifest = 'sessionId' in target ? snapshot.sessions.find(item => item.id === target.sessionId) : undefined;
        const folder = browserTargetFolder(target, path, manifest?.folder);
        const project = preserveProject ? this.project : resolved ?? await this.projects.forFolder(folder, snapshot.folders);
        const projects = await this.projects.list(snapshot.folders);
        if (revision !== this.revision) return;
        if (this.project?.project.id !== project?.project.id) this.familyVisible = false;
        const family = manifest ? snapshot.roots.get(manifest.id) : undefined;
        if (family !== this.family) this.familyVisible = false; this.family = family;
        this.project = project; this.path = path; this.session = manifest?.id;
        this.offlinePaths = new Set(projects.filter(item => this.projects.remoteMounts?.projectOffline(item.project.id)).map(item => folderBrowserPath(item.path)));
        this.updateHeader(projects, snapshot.pending.length);
        this.actions.projectsChanged?.(projects);
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
        this.create.hidden = !project; this.toolbarContainer.hidden = !!project;
        this.menu.hidden = !project || !this.actions.projectMenu;
        this.create.disabled = !!project && this.offlinePaths.has(folderBrowserPath(project.path));
        this.create.setAttribute('aria-current', this.draftActive ? 'page' : 'false');
        this.retry.hidden = !pending; this.retry.textContent = t('project.retryDeletion', { count: pending });
        this.selector.update([{ id: '/', label: t('workbench.allProjects') },
            ...projects.map(item => ({ id: folderBrowserPath(item.path), label: item.name })),
            { id: '@new-project', label: t('project.create') + '…' }], project ? folderBrowserPath(project.path) : '/');
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
        const renamed = snapshot.folders.find(folder => folder.project?.id === this.project?.project.id);
        if (this.project && renamed?.project && renamed.path !== this.project.path) {
            const next = renamed as ProjectFolder;
            this.path = remapProjectPath(this.path, folderBrowserPath(this.project.path), folderBrowserPath(next.path));
            this.actions.projectRenamed?.(this.project, next);
            this.project = next;
        }
        const manifest = this.session ? snapshot.sessions.find(item => item.id === this.session) : undefined;
        const path = this.session && !manifest ? folderBrowserPath(this.project?.path) : manifest ? `${folderBrowserPath(manifest.folder)}/${manifest.id}` : this.path;
        await this.apply(snapshot, path, revision, undefined, true);
    }
    currentProject(): ProjectFolder | undefined { return this.project; }
}
function findNode(items: VFSNodeUI[], id: string): VFSNodeUI | undefined {
    for (const node of items) {
        if (node.id === id) return node;
        const child = node.children && findNode(node.children, id); if (child) return child;
    }
}
