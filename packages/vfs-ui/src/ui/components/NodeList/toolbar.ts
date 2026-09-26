import { escapeHTML, t, VFS_TOOLBAR_ICONS } from '@itookit/common';

export type VFSToolbarAction = string;
export interface VFSToolbarContext { selectedIds: string[]; activeId: string | null; parentPath: string | null }
export interface VFSToolbarOptions {
    items?: readonly { id: string; label: string; disabled?: boolean }[];
    hiddenActions?: VFSToolbarAction[];
    fileLabel?: string;
    directoryLabel?: string;
    directoryFirst?: boolean;
    actions?: Partial<Record<VFSToolbarAction, (context: VFSToolbarContext) => Promise<void>>>;
    /** A compact title-bar action, such as returning to the navigation list. */
    secondary?: { label: string; run(): void };
}

export function toolbarHTML(options: VFSToolbarOptions, fileLabel: string): string {
    if (options.items) return options.items.map(item => `<button type="button" class="vfs-node-list__new-btn" data-action="${escapeHTML(item.id)}" ${item.disabled ? 'disabled' : ''}>${escapeHTML(item.label)}</button>`).join('');
    const labels: Record<string, string> = { 'create-file': options.fileLabel ?? fileLabel, 'create-directory': options.directoryLabel ?? t('vfs.toolbar.directory'),
        import: t('vfs.toolbar.import'), export: t('vfs.toolbar.export') };
    const order: VFSToolbarAction[] = options.directoryFirst
        ? ['create-directory', 'create-file', 'import', 'export'] : ['create-file', 'create-directory', 'import', 'export'];
    return order.filter(action => !options.hiddenActions?.includes(action)).map(action => {
        const create = action.startsWith('create-'), label = labels[action];
        const title = create ? t('vfs.toolbar.create', { name: label }) : label;
        return `<button type="button" class="vfs-node-list__new-btn ${create ? '' : 'vfs-node-list__new-btn--icon'}" data-action="${action}" title="${escapeHTML(title)}" aria-label="${escapeHTML(title)}">${create ? '<span aria-hidden="true">+</span>' : VFS_TOOLBAR_ICONS[action as 'import' | 'export']}<span class="vfs-node-list__button-label">${escapeHTML(label)}</span></button>`;
    }).join('');
}
