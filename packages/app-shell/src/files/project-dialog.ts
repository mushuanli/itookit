import { t } from '@itookit/common';
import type { ProjectService } from '@itookit/app-core';

/** Keep validation errors and the user's draft inside the dialog. */
export function showNameDialog(title: string, label: string, signal: AbortSignal,
    save: (name: string) => Promise<void>, extra?: HTMLElement, options?: { initialName?: string; confirmLabel?: string; hideName?: boolean }): Promise<void> {
    if (signal.aborted) return Promise.resolve();
    return new Promise(resolve => {
        const dialog = document.createElement('dialog'); dialog.className = 'project-dialog';
        dialog.setAttribute('aria-label', title);
        const heading = document.createElement('h2'); heading.textContent = title;
        const form = document.createElement('form');
        const field = document.createElement('label'); field.textContent = label;
        const input = document.createElement('input'); input.required = !options?.hideName; field.hidden = !!options?.hideName; input.autofocus = !options?.hideName; input.value = options?.initialName ?? ''; field.append(input);
        const status = document.createElement('p'); status.setAttribute('role', 'alert');
        const actions = document.createElement('div'); actions.className = 'project-dialog__actions';
        const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = t('project.cancel');
        const submit = document.createElement('button'); submit.type = 'submit'; submit.textContent = options?.confirmLabel ?? t('project.createConfirm');
        const close = () => { dialog.close(); dialog.remove(); signal.removeEventListener('abort', close); resolve(); };
        cancel.onclick = close; dialog.oncancel = event => { event.preventDefault(); close(); };
        form.onsubmit = event => {
            event.preventDefault(); if (submit.disabled) return; submit.disabled = true;
            void save(input.value.trim()).then(close).catch(error => { status.textContent = error.message; })
                .finally(() => { submit.disabled = false; });
        };
        actions.append(cancel, submit); form.append(field); if (extra) form.append(extra); form.append(status, actions);
        dialog.append(heading, form); signal.addEventListener('abort', close, { once: true });
        document.body.append(dialog); dialog.showModal();
    });
}

export async function showProjectDialog(projects: ProjectService, parent: string | null, signal: AbortSignal,
    created: (path: string) => Promise<void>): Promise<void> {
    const fields = document.createElement('div');
    const group = document.createElement('label'); group.textContent = t('project.group');
    const select = document.createElement('select');
    const root = document.createElement('option'); root.value = ''; root.textContent = t('project.root'); select.append(root);
    const folders = (await projects.sessions.navigation()).folders;
    for (const folder of folders) {
        if (await projects.forFolder(folder.path)) continue;
        const option = document.createElement('option'); option.value = folder.path; option.textContent = folder.path; select.append(option);
    }
    select.value = parent ?? ''; group.append(select); fields.append(group);
    const hint = document.createElement('p'); hint.textContent = t('project.directoryHint'); fields.append(hint);
    let directory: string | undefined;
    if (projects.canSelectDirectory) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = t('project.openDirectory');
        button.onclick = () => { void projects.chooseDirectory().then(path => {
            if (path) { directory = path.startsWith('host:') ? path : `host:${path}`; button.textContent = path; }
        }).catch(error => { hint.textContent = error.message; }); }; fields.append(button);
    }
    await showNameDialog(t('project.create'), t('project.name'), signal, async name => {
        const project = await projects.create(name, select.value || null, directory); await created(project.path);
    }, fields);
}
