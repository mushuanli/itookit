import { t } from '@itookit/common';
import { resolveBrowserTarget, folderPathFromBrowserPath } from '@itookit/app-core';
import type { VFSNodeUI } from '@itookit/vfs-ui';

export function fileFirst(a: VFSNodeUI, b: VFSNodeUI): number | undefined {
    const favorites = (item: VFSNodeUI) => resolveBrowserTarget(item.id).kind === 'favorites';
    if (favorites(a) !== favorites(b)) return favorites(a) ? -1 : 1;
    const files = (item: VFSNodeUI) => resolveBrowserTarget(item.id).kind === 'project-files';
    if (files(a) !== files(b)) return files(a) ? -1 : 1;
    const session = (item: VFSNodeUI) => resolveBrowserTarget(item.id).kind === 'session';
    if (session(a) && session(b)) return (new Date(b.metadata.lastModified).getTime() - new Date(a.metadata.lastModified).getTime()) || a.id.localeCompare(b.id);
    return undefined;
}
export function projectItems(items: VFSNodeUI[], query = '', family?: string): VFSNodeUI[] {
    return items.flatMap(item => {
        const kind = resolveBrowserTarget(item.id).kind;
        if (kind === 'session') {
            if (!query.trim() && family !== item.metadata.custom.familyRoot && item.metadata.custom.familyRoot && item.metadata.custom.familyRoot !== item.id.split('/').pop()) return [];
            const count = item.metadata.custom.familyRoot === item.id.split('/').pop() ? Number(item.metadata.custom.familyCount ?? 1) - 1 : 0;
            return [{ ...item, presentation: { ...item.presentation, quickDelete: true }, children: undefined, metadata: { ...item.metadata,
                title: item.metadata.title + (count ? ` (${count})` : ''),
                custom: { ...item.metadata.custom, navigationDescription: (query.trim() || family) && item.metadata.custom.parentTitle
                    ? t('project.parentSession', { name: String(item.metadata.custom.parentTitle) }) : '' } } }];
        }
        if (kind === 'favorite') return [{ ...item, children: undefined }];
        if (kind === 'favorites') return [item];
        if (kind === 'project-files') return [{ ...item, children: item.children && projectItems(item.children, query, family) }];
        if (kind !== 'folder') return [];
        if (folderPathFromBrowserPath(item.id)?.endsWith('/@sessions')) return projectItems(item.children ?? [], query, family);
        return [{ ...item, children: item.children && projectItems(item.children, query, family) }];
    });
}
