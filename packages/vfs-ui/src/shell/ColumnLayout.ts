import { t } from '@itookit/common';
import type { VFSNodeUI } from '../contracts/types';

export interface VFSColumnsOptions {
    navigationTitle: string;
    backLabel?: string;
    navigationToolbar?: 'full' | 'compact' | 'hidden';
    navigationToolbarOptions?: import('../ui/components/NodeList/toolbar').VFSToolbarOptions;
    /** Hosts select navigation entries; VFS UI does not know project/session semantics. */
    navigationItems(items: VFSNodeUI[], query?: string): VFSNodeUI[];
    navigationHeader?: HTMLElement;
    navigationSearchPlaceholder?: string;
    navigationActiveId?: (id: string | null) => string | null;
    navigationSearch?: (query: string) => void;
    contentHeader?: HTMLElement;
    contentCompareItems?: (a: VFSNodeUI, b: VFSNodeUI) => number | undefined;
    contentItems?: (items: VFSNodeUI[]) => VFSNodeUI[];
    navigationAction?: { label: string; visible(path: string): boolean; run(path: string): Promise<void> };
    navigationCard?: (node: VFSNodeUI) => boolean;
    /** Additional directories whose children are projected directly into an expanded navigation row. */
    navigationChildren?: (node: VFSNodeUI) => string[];
    navigationCompareItems?: (a: VFSNodeUI, b: VFSNodeUI) => number | undefined;
    navigationLeaf?: (node: VFSNodeUI) => boolean;
    contentLeaf?: (node: VFSNodeUI) => boolean;
}

/** Two browser columns, progressively disclosed on narrow screens. */
export class ColumnLayout {
    readonly navigation = document.createElement('div');
    readonly content = document.createElement('div');
    private readonly root = document.createElement('div');
    private readonly back = document.createElement('button');
    constructor(container: HTMLElement, options: VFSColumnsOptions) {
        this.root.className = 'vfs-columns'; this.root.dataset.column = 'navigation';
        this.navigation.className = 'vfs-columns__list'; this.content.className = 'vfs-columns__list';
        const navigation = this.pane('navigation', options.navigationTitle, this.navigation, options.navigationHeader);
        const content = this.pane('content', t('vfs.columns.content'), this.content, options.contentHeader);
        this.back.type = 'button'; this.back.className = 'vfs-columns__back';
        this.back.textContent = `← ${options.backLabel ?? t('vfs.columns.back')}`;
        this.back.onclick = () => this.show('navigation');
        content.prepend(this.back); this.root.append(navigation, content); container.append(this.root);
    }
    private pane(kind: string, label: string, list: HTMLElement, header?: HTMLElement): HTMLElement {
        const pane = document.createElement('section'); pane.className = kind === 'navigation' ? 'vfs-columns__navigation' : 'vfs-columns__content';
        pane.setAttribute('aria-label', label);
        if (header) pane.append(header);
        pane.append(list); return pane;
    }
    show(column: 'navigation' | 'content'): void {
        this.root.dataset.column = column;
        const target = column === 'navigation' ? this.navigation.querySelector<HTMLInputElement>('input[type=search]') : this.back;
        if (target && target.getClientRects().length) target.focus();
    }
    setContentVisible(visible: boolean): void { this.root.dataset.contentVisible = String(visible); }
    destroy(): void { this.back.onclick = null; this.root.remove(); }
}
