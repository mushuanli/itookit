import { t } from '@itookit/common';
import type { ProjectService } from '@itookit/app-core';

/** Project inputs reference connection IDs; display names can change independently. */
export function remoteProjectFields(projects: ProjectService, parent: HTMLElement, local: HTMLElement) {
    const type = selectField(parent, 'remote.projectType', [
        ['local', t('remote.localProject')], ['remote', t('remote.remoteProject')],
    ]);
    const fields = document.createElement('div'); parent.append(fields); fields.hidden = true;
    const connection = selectField(fields, 'remote.connection', (projects.remoteMounts?.connections() ?? []).map(item => [item.id, item.name]));
    const label = document.createElement('label'); label.textContent = t('remote.projectPath');
    const path = document.createElement('input'); path.value = '/docs'; path.setAttribute('aria-label', t('remote.projectPath')); label.append(path); fields.append(label);
    const hint = document.createElement('p'); hint.textContent = t(connection.options.length ? 'remote.projectPathHint' : 'remote.connectionEmpty'); fields.append(hint);
    const accessLabel = document.createElement('label'); accessLabel.textContent = t('remote.writable');
    const writable = document.createElement('input'); writable.type = 'checkbox'; accessLabel.append(writable); fields.append(accessLabel);
    type.onchange = () => { fields.hidden = type.value !== 'remote'; local.hidden = type.value === 'remote'; };
    return { isRemote: () => type.value === 'remote', connection, path, writable };
}
function selectField(parent: HTMLElement, key: Parameters<typeof t>[0], options: string[][]) {
    const label = document.createElement('label'); label.textContent = t(key);
    const select = document.createElement('select'); select.setAttribute('aria-label', t(key));
    for (const [value, name] of options) { const option = document.createElement('option'); option.value = value; option.textContent = name; select.append(option); }
    label.append(select); parent.append(label); return select;
}
