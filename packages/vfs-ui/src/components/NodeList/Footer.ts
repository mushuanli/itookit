/**
 * @file vfs-ui/components/NodeList/Footer.ts
 * @desc Component for the NodeList footer and bulk action bar.
 */
import { createFooterHTML } from './templates';

export interface FooterProps {
    selectionStatus: 'none' | 'partial' | 'all';
    selectedCount: number;
    isReadOnly: boolean;
}

export interface FooterCallbacks {
    onSelectAllToggle: () => void;
    onBulkDelete: () => void;
    onBulkMove: () => void;
    onSettingsClick: () => void;
    onDeselectAll: () => void;
}

export class Footer {
    private element: HTMLElement;
    private callbacks: FooterCallbacks;

    constructor(container: HTMLElement, callbacks: FooterCallbacks) {
        this.element = container;
        this.callbacks = callbacks;
        this.bindEvents();
    }

    private bindEvents() {
        this.element.addEventListener('click', (e: MouseEvent) => {
            const target = e.target as Element;
            const actionEl = target.closest('[data-action]');
            if (!actionEl || (target as HTMLInputElement).disabled) return;

            const action = actionEl.getAttribute('data-action');
            switch (action) {
                case 'toggle-select-all': this.callbacks.onSelectAllToggle(); break;
                case 'bulk-delete': this.callbacks.onBulkDelete(); break;
                case 'bulk-move': this.callbacks.onBulkMove(); break;
                case 'settings': this.callbacks.onSettingsClick(); break;
                case 'deselect-all': this.callbacks.onDeselectAll(); break;
            }
        });
    }

    public render(props: FooterProps) {
        this.element.innerHTML = createFooterHTML(props);
        const checkbox = this.element.querySelector<HTMLInputElement>('.vfs-node-list__footer-checkbox');
        if (checkbox) {
            checkbox.indeterminate = props.selectionStatus === 'partial';
        }
    }
}
