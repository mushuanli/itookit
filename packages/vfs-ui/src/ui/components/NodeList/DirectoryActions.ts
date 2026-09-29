import type { DirectoryAction } from '../../../contracts/options';
import type { ActionRunner } from '../../../interaction/ActionRunner';

/** Owns directory-action DOM and pending state; the host owns visibility and selection policy. */
export class DirectoryActions {
    private readonly pending = new Set<string>();
    private disposed = false;
    constructor(private readonly body: HTMLElement, private readonly action: DirectoryAction,
        private readonly runner: ActionRunner, private readonly onActive: () => void) {}

    render(): void {
        for (const row of this.body.querySelectorAll<HTMLElement>('[data-item-type="directory"]')) {
            const path = row.dataset.itemId!;
            if (!this.action.visible(path)) continue;
            const container = row.querySelector(row.classList.contains('vfs-directory-item--card')
                ? ':scope > .vfs-directory-item__children' : ':scope > .vfs-node-item__main-row');
            if (!container || container.querySelector(':scope > .vfs-directory-action')) continue;
            const button = this.createButton(path);
            const anchor = this.anchor(container, path);
            if (anchor) anchor.after(button); else container.append(button);
        }
        this.refresh();
    }

    private createButton(path: string): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'vfs-directory-action'; button.dataset.directoryAction = path;
        if (this.action.icon) {
            const icon = document.createElement('span'); icon.className = 'vfs-directory-action__icon';
            icon.setAttribute('aria-hidden', 'true'); icon.innerHTML = this.action.icon; button.append(icon);
        }
        const label = document.createElement('span'); label.textContent = this.action.label; button.append(label);
        button.draggable = false;
        for (const type of ['mousedown', 'pointerdown', 'keydown', 'contextmenu', 'dragstart']) {
            button.addEventListener(type, event => {
                event.stopPropagation();
                if (type === 'contextmenu' || type === 'dragstart') event.preventDefault();
            });
        }
        button.onclick = event => { event.stopPropagation(); this.run(path); };
        return button;
    }

    private run(path: string): void {
        if (this.pending.has(path) || !this.action.visible(path) || this.action.disabled?.(path)) return;
        this.pending.add(path); this.refresh();
        void this.runner.run(`directory:${path}`, () => this.action.run(path))
            .catch(() => {}).finally(() => { this.pending.delete(path); this.refresh(); });
    }

    private anchor(container: Element, path: string): Element | undefined {
        const children = [...container.querySelectorAll<HTMLElement>(':scope > [data-item-id]')];
        const childId = this.action.afterChildId?.(path);
        if (childId) return children.find(child => child.dataset.itemId === childId);
        return this.action.placement === 'after-first' ? children[0] : undefined;
    }

    destroy(): void { this.disposed = true; this.pending.clear(); }

    refresh(): void {
        if (this.disposed) return;
        const buttons = [...this.body.querySelectorAll<HTMLButtonElement>('[data-directory-action]')];
        const active = buttons.find(button => this.action.active?.(button.dataset.directoryAction!));
        if (active) {
            this.onActive();
            for (const node of this.body.querySelectorAll('.is-active, .is-selected')) node.classList.remove('is-active', 'is-selected');
        }
        for (const button of buttons) {
            const path = button.dataset.directoryAction!;
            button.disabled = this.pending.has(path) || (this.action.disabled?.(path) ?? false);
            button.classList.toggle('is-active', button === active);
            if (button === active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
        }
    }
}
