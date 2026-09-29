import { resolveBrowserTarget, type ProjectFavoriteTarget, type ProjectService } from '@itookit/app-core';
import type { ISessionRepository } from '@itookit/llm-session';
import type { FavoriteAction, VFSNodeUI } from '@itookit/vfs-ui';

type FavoriteRoute = Extract<ReturnType<typeof resolveBrowserTarget>, { kind: 'project-files' | 'session' | 'favorite' }>;

/** Translate generic row controls into project commands; refresh is driven by service events. */
export function projectFavoriteAction(projects: ProjectService, repository: ISessionRepository): FavoriteAction {
    return {
        state: node => {
            const target = favoriteRoute(node.id);
            if (!target) return undefined;
            return target.kind === 'favorite' || !!node.metadata.custom._favorite;
        },
        toggle: async node => {
            const target = favoriteRoute(node.id);
            if (target) await toggleFavorite(projects, repository, target, node);
        },
    };
}
function favoriteRoute(path: string): FavoriteRoute | undefined {
    try {
        const target = resolveBrowserTarget(path);
        if (target.kind === 'project-files' || target.kind === 'session' || target.kind === 'favorite') return target;
    } catch { /* Other workspaces use different resource routes. */ }
}
async function toggleFavorite(projects: ProjectService, repository: ISessionRepository, target: FavoriteRoute, node: VFSNodeUI): Promise<void> {
    const folder = target.kind === 'session' ? (await repository.getManifest(target.sessionId)).folder : target.folder;
    const project = await projects.forFolder(folder);
    if (!project) return;
    if (target.kind === 'favorite') return projects.favorites.remove(project.project.id, target.favoriteId);
    const favorite: ProjectFavoriteTarget = target.kind === 'project-files'
        ? { kind: 'file', path: target.path, nodeType: node.type } : { kind: 'session', sessionId: target.sessionId };
    await projects.favorites.toggle(project.project.id, favorite, node.metadata.title);
}
