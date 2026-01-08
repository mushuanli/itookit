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
    constructor(private element: HTMLElement, private callbacks: FooterCallbacks) {
        this.bindEvents();
    }

    private bindEvents() {
        this.element.addEventListener('click', (e: MouseEvent) => {
            const actionEl = (e.target as Element).closest('[data-action]');
            if (!actionEl || (e.target as HTMLInputElement).disabled) return;

            const handlers: Record<string, () => void> = {
                'toggle-select-all': this.callbacks.onSelectAllToggle,
                'bulk-delete': this.callbacks.onBulkDelete,
                'bulk-move': this.callbacks.onBulkMove,
                'settings': this.callbacks.onSettingsClick,
                'deselect-all': this.callbacks.onDeselectAll,
            };

            handlers[actionEl.getAttribute('data-action') || '']?.();
        });
    }

    render(props: FooterProps) {
        this.element.innerHTML = createFooterHTML(props);
        const checkbox = this.element.querySelector<HTMLInputElement>('.vfs-node-list__footer-checkbox');
        if (checkbox) checkbox.indeterminate = props.selectionStatus === 'partial';
    }
}
