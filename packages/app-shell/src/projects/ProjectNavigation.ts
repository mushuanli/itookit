import { t } from '@itookit/common';
import { folderBrowserPath, folderPathFromBrowserPath, resolveBrowserTarget, type ProjectFolder, type ProjectService } from '@itookit/app-core';
import type { VFSToolbarContext, VFSColumnsOptions, VFSNodeUI, VFSUIShell } from '@itookit/vfs-ui';

interface Actions {
    createProject(path?: string | null): Promise<unknown>; createSession(path?: string): Promise<unknown>;
    createChild(id: string): Promise<unknown>; importItems(context: VFSToolbarContext): Promise<void>; exportItems(context: VFSToolbarContext): Promise<void>; report(error: unknown): void;
    retryDeletions(): Promise<void>;
    contentChanged(visible: boolean, family: boolean): void;
}

/** Project semantics stay in the host; both panes use the generic VFS browser. */
export class ProjectNavigation {
    readonly options: VFSColumnsOptions;
    private project?: ProjectFolder;
    private path = '/';
    private session?: string;
    private family?: string;
    private contentScope?: string;
    private hiddenScope?: string;
    private revision = 0;
    private readonly retry = document.createElement('button');
    constructor(private readonly projects: ProjectService, private readonly ui: () => VFSUIShell | undefined,
        private readonly actions: Actions) {
        this.options = { navigationTitle: t('vfs.toolbar.projects'), navigationSearchPlaceholder: t('project.searchProjects'), navigationItems: projectItems,
            navigationActiveId: id => {
                if (!id) return id;
                const target = resolveBrowserTarget(id);
                if (target.kind === 'project-files') return folderBrowserPath(target.folder) + '/@files';
                return target.kind === 'session' && this.family && target.sessionId === this.session ? id.slice(0, id.lastIndexOf('/') + 1) + this.family : id;
            },
            navigationSearch: query => { if (query.trim()) void this.loadSearch().catch(this.actions.report); },
            navigationCard: node => !!node.metadata.custom.projectId,
            navigationChildren: node => node.metadata.custom.projectId ? [node.id + '/folder:%40sessions'] : [],
            navigationLeaf: node => ['session', 'project-files'].includes(resolveBrowserTarget(node.id).kind),
            navigationCompareItems: (a, b) => fileFirst(a, b),
            navigationAction: { label: t('project.createSession'), visible: path => this.projectPaths.has(path),
                run: async path => { await this.actions.createSession(path); } },
            contentLeaf: node => resolveBrowserTarget(node.id).kind === 'session',
            contentCompareItems: (a, b) => this.family ? this.compareFamily(a, b) : undefined,
            contentItems: items => this.family ? this.familyItems(items) : items,
            navigationToolbar: 'full', navigationToolbarOptions: { directoryFirst: true, directoryLabel: t('vfs.toolbar.project'), fileLabel: t('vfs.toolbar.session'),
                actions: this.projectToolbarActions() }, navigationHeader: this.retryHeader() };
    }
    private searchLoading?: Promise<void>;
    private loadSearch(): Promise<void> {
        if (!this.searchLoading) this.searchLoading = this.projects.sessions.navigation()
            .then(({ folders }) => this.ui()?.loadDirectories(folders.map(folder => folderBrowserPath(folder.path))))
            .finally(() => { this.searchLoading = undefined; });
        return this.searchLoading;
    }
    private projectPaths = new Set<string>();
    private projectToolbarActions() {
        return {
            'create-directory': async (context: VFSToolbarContext) => { await this.actions.createProject(context.selectedIds[0] ?? context.parentPath); },
            'create-file': async (context: VFSToolbarContext) => { await this.actions.createSession(context.selectedIds[0] ?? context.activeId ?? undefined); },
            import: this.actions.importItems, export: this.actions.exportItems,
        };
    }
    private retryHeader(): HTMLElement {
        this.retry.type = 'button'; this.retry.hidden = true; this.retry.className = 'vfs-node-list__secondary-action';
        this.retry.onclick = () => { this.retry.disabled = true; void this.actions.retryDeletions().catch(this.actions.report).finally(() => { this.retry.disabled = false; }); };
        return this.retry;
    }
    private contentToolbar(files: boolean): void {
        this.ui()?.setContentToolbar({ directoryFirst: true, directoryLabel: t(files ? 'vfs.toolbar.directory' : 'vfs.toolbar.project'),
            fileLabel: t(files ? 'vfs.toolbar.file' : 'vfs.toolbar.child'),
            actions: { ...(files ? {} : { 'create-directory': this.projectToolbarActions()['create-directory'],
                'create-file': async () => { if (this.session) await this.actions.createChild(this.session); } }),
                import: this.actions.importItems, export: this.actions.exportItems },
            secondary: { label: t('project.hideFamily'), run: () => { this.hiddenScope = this.contentScope; this.ui()?.setContentVisible(false); this.ui()?.showColumn('navigation'); this.actions.contentChanged(false, !!this.family); } },
        });
    }
    async sync(path: string, reveal = false): Promise<void> {
        const revision = ++this.revision;
        const target = resolveBrowserTarget(path);
        const { sessions, roots, pending } = await this.projects.sessions.navigation();
        const manifest = 'sessionId' in target ? sessions.find(item => item.id === target.sessionId) : undefined;
        const project = await this.projects.forFolder(manifest?.folder ?? folderPathFromBrowserPath(path));
        const projects = await this.projects.list();
        if (revision !== this.revision) return;
        this.retry.hidden = !pending.length; this.retry.textContent = t('project.retryDeletion', { count: pending.length });
        this.projectPaths = new Set(projects.map(item => folderBrowserPath(item.path)));
        this.options.navigationAction!.visible = path => this.projectPaths.has(path);
        this.project = project; this.path = path; this.session = manifest?.id;
        this.family = manifest ? roots.get(manifest.id) : undefined;
        const members = this.family ? sessions.filter(item => roots.get(item.id) === this.family) : [];
        const files = target.kind === 'project-files';
        if (files && reveal) this.hiddenScope = undefined;
        await this.updateContent(manifest, members.length, files, reveal, revision);
    }
    private async updateContent(manifest: import('@itookit/llm-session').ConversationManifest | undefined, count: number, files: boolean, reveal: boolean, revision: number): Promise<void> {
        const project = this.project;
        const scope = this.family ?? (files ? folderBrowserPath(project?.path) + '/@files' : undefined);
        if (scope !== this.contentScope) this.ui()?.resetContentState();
        this.contentScope = scope;
        const visible = (files || count > 1) && scope !== this.hiddenScope;
        this.ui()?.setNavigationTitle(project?.name ?? t('project.workspace'));
        this.contentToolbar(files);
        if (project) await this.ui()?.expandPath(folderBrowserPath(project.path));
        if (revision !== this.revision) return;
        const root = files && project ? folderBrowserPath(project.path) + '/@files' : manifest ? folderBrowserPath(manifest.folder) || '/' : null;
        const title = this.family ? t('project.familyCount', { count }) : project?.name ?? t('project.files');
        await this.ui()?.setContentRoot(root, title, reveal && visible);
        if (revision !== this.revision) return;
        this.ui()?.setContentVisible(visible);
        if (!visible) this.ui()?.showColumn('navigation');
        this.actions.contentChanged(visible, !!this.family);
    }
    showContent(): void {
        this.hiddenScope = undefined; this.ui()?.setContentVisible(true); this.ui()?.showColumn('content');
        this.actions.contentChanged(true, !!this.family);
    }
    private compareFamily(a: VFSNodeUI, b: VFSNodeUI): number {
        const root = (item: VFSNodeUI) => item.id.split('/').pop() === this.family;
        if (root(a) !== root(b)) return root(a) ? -1 : 1;
        return new Date(a.metadata.createdAt).getTime() - new Date(b.metadata.createdAt).getTime() || a.id.localeCompare(b.id);
    }
    private familyItems(items: VFSNodeUI[]): VFSNodeUI[] {
        return items.filter(item => item.metadata.custom.familyRoot === this.family).map(item => {
            const root = item.id.split('/').pop() === this.family;
            const parent = item.metadata.custom.parentTitle;
            return { ...item, content: { format: 'text/plain', summary: '', data: null, ...item.content, searchableText: String(parent ?? '') }, metadata: { ...item.metadata, custom: { ...item.metadata.custom,
                navigationDescription: root ? t('project.rootSession') : parent ? t('project.parentSession', { name: String(parent) }) : '' } } };
        });
    }
    async refresh(): Promise<void> {
        let path = this.path;
        if (this.session) {
            const session = (await this.projects.sessions.navigation()).sessions.find(item => item.id === this.session);
            path = session ? `${folderBrowserPath(session.folder)}/${session.id}` : folderBrowserPath(this.project?.path);
        }
        await this.sync(path);
    }
    currentProject(): ProjectFolder | undefined { return this.project; }
}

function fileFirst(a: VFSNodeUI, b: VFSNodeUI): number | undefined {
    const files = (item: VFSNodeUI) => resolveBrowserTarget(item.id).kind === 'project-files';
    if (files(a) !== files(b)) return files(a) ? -1 : 1;
    const session = (item: VFSNodeUI) => resolveBrowserTarget(item.id).kind === 'session';
    if (session(a) && session(b)) return (new Date(b.metadata.createdAt).getTime() - new Date(a.metadata.createdAt).getTime()) || a.id.localeCompare(b.id);
    return undefined;
}
function projectItems(items: VFSNodeUI[], query = ''): VFSNodeUI[] {
    return items.flatMap(item => {
        const kind = resolveBrowserTarget(item.id).kind;
        if (kind === 'session') {
            if (!query.trim() && item.metadata.custom.familyRoot && item.metadata.custom.familyRoot !== item.id.split('/').pop()) return [];
            const count = item.metadata.custom.familyRoot === item.id.split('/').pop() ? Number(item.metadata.custom.familyCount ?? 1) - 1 : 0;
            return [{ ...item, children: undefined, metadata: { ...item.metadata,
                title: item.metadata.title + (count ? ` (${count})` : ''),
                custom: { ...item.metadata.custom, navigationDescription: query.trim() && item.metadata.custom.parentTitle
                    ? t('project.parentSession', { name: String(item.metadata.custom.parentTitle) }) : '' } } }];
        }
        if (kind === 'project-files') return [{ ...item, children: undefined }];
        if (kind !== 'folder') return [];
        if (folderPathFromBrowserPath(item.id)?.endsWith('/@sessions')) return projectItems(item.children ?? [], query);
        return [{ ...item, children: item.children && projectItems(item.children, query) }];
    });
}
