import { ProjectSessions } from './project-sessions';
import { randomUUID, t } from '@itookit/common';
import { FSError, normalizeVirtualPath, type IFileSystem } from '@itookit/vfs-core';
import type { ISessionRepository, SessionFolder } from '@itookit/llm-session';
import type { DirectoryMountService } from '../vfs/directory-mounts';
import type { SessionFilesService } from '../vfs/session-files';

export type ProjectFolder = SessionFolder & { project: NonNullable<SessionFolder['project']> };

/** Project identity and file roots survive navigation-folder renames and moves. */
export class ProjectService {
    private startupId?: string;
    readonly sessions: ProjectSessions;
    constructor(private readonly root: IFileSystem, private readonly repository: ISessionRepository,
        private readonly directories: DirectoryMountService, private readonly files: SessionFilesService) { this.sessions = new ProjectSessions(repository); }

    get canSelectDirectory(): boolean { return this.directories.canSelectHost; }
    chooseDirectory() { return this.directories.chooseDirectory(); }
    async list(): Promise<ProjectFolder[]> {
        return (await this.repository.listFolders()).filter((folder): folder is ProjectFolder => !!folder.project);
    }
    async get(id: string): Promise<ProjectFolder> {
        const project = (await this.list()).find(item => item.project.id === id);
        if (!project) throw new FSError('ENOENT', 'Project not found');
        return project;
    }
    async forFolder(path: string | null | undefined): Promise<ProjectFolder | undefined> {
        return (await this.list()).filter(folder => path === folder.path || path?.startsWith(folder.path + '/'))
            .sort((a, b) => b.path.length - a.path.length)[0];
    }
    async current(): Promise<ProjectFolder | undefined> {
        const projects = await this.list();
        return projects.find(folder => folder.project.id === this.startupId) ?? projects[0];
    }
    async create(name: string, parent: string | null = null, directory?: string): Promise<ProjectFolder> {
        if (!name.trim() || /[/\\\0]/.test(name) || ['.', '..', '@sessions'].includes(name.trim())) throw new FSError('EINVAL', t('project.error.name'));
        if (await this.forFolder(parent)) throw new FSError('EINVAL', t('project.error.nested'));
        const path = normalizeVirtualPath(`${parent ?? ''}/${name.trim()}`);
        if ((await this.repository.listFolders()).some(folder => folder.path === path)) throw new FSError('EEXIST', t('project.error.exists'));
        const id = randomUUID();
        const target = directory ?? `/home/admin/projects/${id}`;
        if (!directory) await this.root.driver.createDirectory({ parentPath: '/home/admin/projects', name: id, recursive: true });
        let project: ProjectFolder | undefined;
        try {
            const source = await this.directories.openDirectory(target); await source.dispose();
            project = await this.repository.createFolder(path, { id, directory: target }) as ProjectFolder;
            await this.sessionFolder(project);
            return project;
        } catch (error) {
            const failures: unknown[] = [error];
            try { if (project) await this.repository.deleteFolder(path, true); } catch (cleanup) { failures.push(cleanup); }
            try { if (!directory && failures.length === 1) await this.root.driver.delete([target], { recursive: true }); } catch (cleanup) { failures.push(cleanup); }
            if (failures.length > 1) throw new AggregateError(failures, 'Project creation and cleanup failed');
            throw error;
        }
    }

    /** Rollback hook for a fresh managed project whose navigation records were removed. */
    async discardImportedProject(project: ProjectFolder): Promise<void> {
        const directory = `/home/admin/projects/${project.project.id}`;
        if (project.project.directory !== directory || (await this.list()).some(item => item.project.id === project.project.id))
            throw new FSError('EACCES', 'Project is not eligible for import rollback');
        await this.root.driver.delete([directory], { recursive: true });
    }
    async ensureDirectory(directory: string, label?: string): Promise<ProjectFolder> {
        const existing = (await this.list()).find(folder => folder.project.directory === directory);
        if (existing) return existing;
        return this.createUnique(label || directory.replace(/\/$/, '').split(/[\\/]/).pop() || t('project.defaultName'), directory);
    }
    private async createUnique(base: string, directory?: string): Promise<ProjectFolder> {
        const folders = await this.repository.listFolders();
        let name = base;
        for (let n = 2; folders.some(folder => folder.path === '/' + name); n++) name = `${base} (${n})`;
        return this.create(name, null, directory);
    }
    async ensureStartup(directory?: string): Promise<void> {
        const existing = directory ? await this.ensureDirectory(directory) : (await this.list()).find(folder =>
            folder.project.directory.startsWith('/home/admin/projects/')) ?? await this.createUnique(t('project.defaultName'));
        this.startupId = existing.project.id;
        await this.sessionFolder(existing);
    }
    async initializeSession(id: string): Promise<boolean> {
        const manifest = await this.repository.getManifest(id);
        const explicit = await this.forFolder(manifest.folder);
        let project = explicit ?? await this.current();
        if (!project && this.startupId) { await this.ensureStartup(); project = await this.current(); }
        if (!project) return false;
        const folder = explicit && manifest.folder !== project.path ? manifest.folder! : await this.folderInProject(project, explicit ? null : manifest.folder);
        await this.directories.setWorkspace(id, project.project.directory);
        if (folder !== manifest.folder) await this.repository.updateManifest(id, { folder });
        return true;
    }
    /** Called only after the host has acquired this Session's write lease. */
    async adoptSession(id: string): Promise<void> {
        const session = await this.repository.getManifest(id).catch(error => {
            if (error?.code === 'ENOENT') return undefined; throw error;
        });
        if (!session || await this.forFolder(session.folder)) return;
        const grant = (await this.files.inspect(id))?.mounts.find(mount => mount.at === '/workspace');
        if (!grant) return;
        const directory = this.directories.describe(grant);
        const project = (await this.list()).find(item => item.project.directory.replace(/^host:/, '') === directory);
        if (!project) return;
        await this.repository.updateManifest(id, { folder: await this.folderInProject(project, session.folder) });
    }
    private async folderInProject(project: ProjectFolder, folder?: string | null): Promise<string> {
        let parent = await this.sessionFolder(project);
        for (const name of (folder ?? '').split('/').filter(Boolean)) {
            parent += '/' + name;
            await this.repository.createFolder(parent);
        }
        return parent;
    }
    async sessionFolder(project: ProjectFolder): Promise<string> {
        const path = project.path + '/@sessions';
        await this.repository.createFolder(path);
        return path;
    }
    async openFiles(folder: string) {
        const project = (await this.list()).find(item => item.path === folder);
        if (!project) throw new FSError('ENOENT', 'Project not found');
        return this.directories.openDirectory(project.project.directory);
    }
    async assertMove(from: string | null, to: string | null, projectRoot = false): Promise<void> {
        const [source, target] = await Promise.all([this.forFolder(from), this.forFolder(to)]);
        if (projectRoot ? !!target : source?.project.id !== target?.project.id) {
            throw new FSError('EACCES', t('project.error.moveAcross'));
        }
    }
}
