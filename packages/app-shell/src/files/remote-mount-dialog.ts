import { t } from '@itookit/common';
import type { ProjectService, ProjectRemoteMountService } from '@itookit/app-core';

/** The dialog owns cancellation; credentials are handed to the host, never persisted here. */
export async function showRemoteMountDialog(projects: ProjectService, folder: string, parentSignal: AbortSignal): Promise<void> {
    const project = (await projects.list()).find(item => item.path === folder);
    if (!project || !projects.remoteMounts || parentSignal.aborted) return;
    await new RemoteMountDialog(projects.remoteMounts, project.project.id, () => projects.openFiles(folder), parentSignal).open();
}

class RemoteMountDialog {
    private readonly dialog = document.createElement('dialog');
    private readonly controller = new AbortController();
    private readonly status = document.createElement('p');
    private readonly list = document.createElement('div');
    private readonly endpoint = this.input('remote.endpoint', 'https://files.example.com');
    private readonly alias = this.input('remote.alias', 'docs');
    private readonly root = this.input('remote.root', '/');
    private readonly at = this.input('remote.at', '/reference');
    private readonly token = this.input('remote.token', '', 'password');
    private readonly writable = this.input('remote.writable', '', 'checkbox');
    private busy = false;
    constructor(private readonly service: ProjectRemoteMountService, private readonly projectId: string,
        private readonly openFiles: () => Promise<import('@itookit/vfs-core').FileSystemSourceOwner>, private readonly parent: AbortSignal) {}
    open(): Promise<void> {
        return new Promise(resolve => {
            this.dialog.className = 'project-dialog';
            const title = document.createElement('h2'); title.textContent = t('remote.title');
            this.dialog.prepend(title); this.dialog.setAttribute('aria-label', title.textContent);
            const hint = document.createElement('p'); hint.textContent = t('remote.hint');
            this.dialog.append(hint, this.list, this.status); this.status.setAttribute('role', 'status');
            this.button(this.dialog, t('remote.add'), () => this.add());
            const close = () => { this.controller.abort(); this.token.value = ''; this.dialog.remove(); this.parent.removeEventListener('abort', close); resolve(); };
            const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = t('project.cancel'); cancel.onclick = close;
            this.dialog.append(cancel); this.dialog.oncancel = event => { event.preventDefault(); close(); };
            this.parent.addEventListener('abort', close, { once: true });
            if (this.parent.aborted) { close(); return; }
            this.render(); document.body.append(this.dialog); this.dialog.showModal();
        });
    }
    private input(key: Parameters<typeof t>[0], initial: string, type = 'text') {
        const label = document.createElement('label'); label.textContent = t(key);
        const input = document.createElement('input'); input.type = type; input.value = initial;
        input.setAttribute('aria-label', t(key)); input.autocomplete = 'off'; label.append(input); this.dialog.append(label); return input;
    }
    private button(parent: HTMLElement, label: string, action: () => Promise<void>) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
        button.onclick = () => { void this.run(action); }; parent.append(button);
    }
    private async add() {
        const owner = await this.openFiles();
        try { await this.service.add(this.projectId, { endpoint: this.endpoint.value.trim(), alias: this.alias.value.trim(),
            root: this.root.value.trim(), at: this.at.value.trim(), access: this.writable.checked ? 'rw' : 'ro' }, this.token.value, owner.fs, { signal: this.controller.signal }); }
        finally { await owner.dispose(); }
    }
    private render() {
        this.list.replaceChildren();
        for (const mount of this.service.list(this.projectId)) {
            const row = document.createElement('p'); row.textContent = `${mount.alias}:${mount.root} → ${mount.at} (${t(mount.access === 'rw' ? 'mount.access.rw' : 'mount.access.ro')}) `;
            this.button(row, t('mount.dialog.remove'), () => this.service.remove(this.projectId, mount.mountId));
            this.button(row, t('mount.dialog.reconnect'), () => this.service.reconnect(this.projectId, mount.mountId, this.token.value, { signal: this.controller.signal }));
            this.list.append(row);
        }
        if (this.service.diagnostics.get(this.projectId)?.length) {
            const warning = document.createElement('p'); warning.textContent = t('remote.degraded'); this.list.append(warning);
        }
    }
    private async run(action: () => Promise<void>) {
        if (this.busy || this.controller.signal.aborted) return;
        this.busy = true; this.status.textContent = t('remote.connecting');
        try { await action(); this.token.value = ''; this.status.textContent = t('remote.saved'); this.render(); }
        catch (error) {
            if (this.controller.signal.aborted) return;
            const code = (error as { code?: string }).code;
            this.status.textContent = t(code === 'EEXIST' ? 'remote.conflict' : code === 'EBUSY' ? 'remote.busy' : 'remote.failed');
        } finally { this.busy = false; }
    }
}
