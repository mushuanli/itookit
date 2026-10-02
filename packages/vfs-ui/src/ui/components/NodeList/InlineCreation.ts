import { FILE_BROWSER_ICONS, t } from '@itookit/common';
import type { VFSRowActionOptions } from '../../../contracts/options';
import type { VFSNodeUI } from '../../../contracts/types';
import { allowsRowAction } from '../../../utils/row-policy';
import type { ActionRunner } from '../../../interaction/ActionRunner';

/** Creation belongs to the hovered directory; recheck its current policy before dispatch. */
export function renderInlineCreation(body: HTMLElement, creation: NonNullable<VFSRowActionOptions['rowCreation']>,
    find: (id: string) => VFSNodeUI | null, readOnly: () => boolean, runner: ActionRunner): void {
    for (const row of body.querySelectorAll<HTMLElement>('[data-item-type="directory"]')) {
        const node = find(row.dataset.itemId!); if (!node || !creation.visible(node)) continue;
        const header = row.querySelector(':scope > .vfs-node-item__main-row');
        if (!header || header.querySelector('.vfs-node-item__creation')) continue;
        const controls = document.createElement('span'); controls.className = 'vfs-node-item__creation';
        for (const type of ['file', 'directory'] as const) {
            const action = type === 'file' ? 'create-in-folder-session' : 'create-in-folder-folder';
            if (!allowsRowAction(action, readOnly(), node)) continue;
            const button = document.createElement('button'); button.type = 'button'; button.dataset.rowCreate = type;
            button.className = 'vfs-node-item__action-btn'; button.innerHTML = FILE_BROWSER_ICONS[type === 'file' ? 'addFile' : 'addFolder'];
            button.title = t(type === 'file' ? 'project.createFile' : 'project.createFolder'); button.setAttribute('aria-label', button.title);
            button.onpointerdown = event => event.stopPropagation();
            button.onclick = event => {
                event.stopPropagation(); const latest = find(node.id);
                if (latest && creation.visible(latest) && allowsRowAction(action, readOnly(), latest))
                    void runner.run(`create:${node.id}`, () => creation.run(latest, type)).catch(() => {});
            }; controls.append(button);
        }
        if (controls.childNodes.length) header.insertBefore(controls, header.querySelector(':scope > [data-action="favorite-toggle"]'));
    }
}
