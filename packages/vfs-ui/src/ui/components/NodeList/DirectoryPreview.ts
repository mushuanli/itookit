import { t } from '@itookit/common';
import type { VFSNodeUI } from '../../../contracts/types';
import type { NodeListState } from './NodeListState';

/** A display limit never changes the source tree or selection/export scope. */
export class DirectoryPreview {
    private readonly expanded = new Set<string>();
    constructor(private readonly limit?: (directory: VFSNodeUI) => number | undefined) {}
    project(directory: VFSNodeUI, state: NodeListState) {
        const children = directory.children ?? [], limit = this.limit?.(directory);
        if (state.searchQuery || limit === undefined || !Number.isFinite(limit) || limit < 1 || children.length <= limit) return { children };
        const expanded = this.expanded.has(directory.id);
        const visible = expanded ? children : children.filter((child, index) => index < Math.floor(limit) || this.containsSelection(child, state, new Set()));
        if (!expanded && visible.length === children.length) return { children };
        return { children: visible, expanded, hidden: children.length - visible.length };
    }
    private containsSelection(node: VFSNodeUI, state: NodeListState, visited: Set<string>): boolean {
        if (visited.has(node.id)) return false;
        visited.add(node.id);
        return node.id === state.activeId || state.selectedItemIds.has(node.id) ||
            !!node.children?.some(child => this.containsSelection(child, state, visited));
    }
    control(id: string, expanded: boolean, hidden: number, render: () => void): HTMLButtonElement {
        const button = document.createElement('button'); button.type = 'button';
        button.className = 'vfs-directory-item__preview-toggle'; button.dataset.previewId = id;
        button.setAttribute('aria-expanded', String(expanded));
        button.textContent = expanded ? t('vfs.preview.collapse') : t('vfs.preview.more', { count: hidden });
        button.onclick = event => { event.stopPropagation(); expanded ? this.expanded.delete(id) : this.expanded.add(id); render(); };
        return button;
    }
    clear(): void { this.expanded.clear(); }
}
