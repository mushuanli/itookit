import { FSError } from '@itookit/vfs-core';
import { folderBrowserPath } from '../../session/browser-routes';
import { projectRelativePath } from '../../vfs/workspace-namespace';
import type { ISessionRepository } from '@itookit/llm-session';
import type { ProjectService } from '../project-service';

export interface ResolvedProjectFavorite { path: string; kind: 'file' | 'directory' | 'session' }

export async function resolveProjectFavorite(projects: Pick<ProjectService, 'forFolder' | 'favorites'>, repository: Pick<ISessionRepository, 'getManifest'>,
    folder: string, id: string): Promise<ResolvedProjectFavorite> {
    const project = await projects.forFolder(folder);
    if (!project || project.path !== folder) throw new FSError('ENOENT', 'Favorite project not found');
    const favorite = (await projects.favorites.list(project.project.id)).find(item => item.id === id);
    if (!favorite) throw new FSError('ENOENT', 'Favorite not found');
    if (favorite.target.kind === 'file') return { kind: favorite.target.nodeType, path: folderBrowserPath(project.path) + '/@files'
        + (favorite.target.path === '/workspace' ? '' : projectRelativePath(favorite.target.path)) };
    const session = await repository.getManifest(favorite.target.sessionId);
    if ((await projects.forFolder(session.folder))?.project.id !== project.project.id) throw new FSError('ENOENT', 'Favorite session left this project');
    return { kind: 'session', path: `${folderBrowserPath(session.folder)}/${session.id}` };
}
