import { BaseSettingsEditor, type EditorOptions } from '@itookit/ui-common';
import type { ProjectService, RemoteFileSystemConfig } from '@itookit/app-core';
import { ENTITY_ICONS, t } from '@itookit/common';
import { remoteConnectionError } from './remote-connection-error';
import { showNameDialog } from './project-dialog';

/** Connections are shared by projects; passwords stay in the host credential provider. */
export class RemoteFilesSettingsEditor extends BaseSettingsEditor<ProjectService> {
    private readonly controller = new AbortController();
    private unsubscribe?: () => void;
    constructor(container: HTMLElement, service: ProjectService, options: EditorOptions) { super(container, service, options); }
    async init(container: HTMLElement) {
        await super.init(container);
        container.classList.remove('settings-root');
        container.classList.add('remote-settings');
        this.unsubscribe = this.service.remoteMounts?.onChange(() => { void this.render(); });
    }
    async render(): Promise<void> {
        if (this.controller.signal.aborted) return;
        const page = document.createElement('div'); page.className = 'settings-section';
        const header = document.createElement('div'); header.className = 'remote-settings__header';
        const title = document.createElement('h2'); title.textContent = `${ENTITY_ICONS.remoteProject} ${t('remote.settings')}`;
        const hint = document.createElement('p'); hint.textContent = t('remote.settingsHint'); header.append(title); page.append(header, hint);
        this.button(header, t('remote.connectionAdd'), () => this.edit());
        const connections = this.service.remoteMounts?.connections() ?? [];
        for (const connection of connections) page.append(this.connectionRow(connection));
        if (!connections.length) { const empty = document.createElement('p'); empty.textContent = t('remote.connectionEmpty'); page.append(empty); }
        this.container.replaceChildren(page);
    }
    private connectionRow(connection: RemoteFileSystemConfig): HTMLElement {
        const row = document.createElement('section'); row.className = 'remote-settings__project';
        const content = document.createElement('div'); content.className = 'remote-settings__details';
        const label = document.createElement('h3'); label.textContent = connection.name;
        const address = document.createElement('p'); address.textContent = `${connection.endpoint} · ${connection.username}`;
        const status = document.createElement('span'); status.className = 'remote-settings__status';
        status.dataset.state = this.service.remoteMounts!.connectionStatus(connection.id);
        status.textContent = t(`remote.state.${this.service.remoteMounts!.connectionStatus(connection.id)}`);
        content.append(label, address, status);
        const actions = document.createElement('div'); actions.className = 'remote-settings__actions';
        this.button(actions, t('remote.connectionEdit'), () => this.edit(connection));
        this.button(actions, t('remote.connectionRemove'), async () => { await this.service.remoteMounts!.removeConnection(connection.id); });
        row.append(content, actions); return row;
    }
    private async edit(connection?: RemoteFileSystemConfig): Promise<void> {
        const fields = document.createElement('div');
        const controller = new AbortController();
        const abort = () => controller.abort();
        this.controller.signal.addEventListener('abort', abort, { once: true });
        const endpoint = this.input(fields, 'remote.endpoint', connection?.endpoint ?? '', 'text'); endpoint.placeholder = '127.0.0.1:8787';
        const username = this.input(fields, 'remote.username', connection?.username ?? '', 'text');
        const password = this.input(fields, 'remote.password', '', 'password');
        password.required = !connection;
        password.placeholder = t(connection ? 'remote.passwordKeep' : 'remote.passwordRequired');
        const hint = document.createElement('p'); hint.textContent = t('remote.connectionHint'); fields.append(hint);
        const validate = this.connectionCheck(fields, endpoint, username, password, controller.signal, connection);
        try {
            await showNameDialog(t(connection ? 'remote.connectionEdit' : 'remote.connectionAdd'), t('remote.connectionName'), this.controller.signal, async name => {
                try { await validate(name); } catch (error) { throw new Error(remoteConnectionError(error)); }
                try { await this.service.remoteMounts!.saveConnection({ name, endpoint: endpoint.value.trim(), username: username.value.trim() }, password.value, connection?.id); }
                catch { throw new Error(t('remote.connectionFailed')); }
            }, fields, { initialName: connection?.name, confirmLabel: t('remote.connectionSave') });
        } finally { controller.abort(); this.controller.signal.removeEventListener('abort', abort); password.value = ''; }
    }
    private connectionCheck(fields: HTMLElement, endpoint: HTMLInputElement, username: HTMLInputElement,
        password: HTMLInputElement, lifetime: AbortSignal, connection?: RemoteFileSystemConfig) {
        const status = document.createElement('p'); status.setAttribute('role', 'status');
        let check: AbortController | undefined;
        const validate = async (name: string) => {
            check?.abort(); check = new AbortController();
            const signal = AbortSignal.any([lifetime, check.signal]);
            status.textContent = t('remote.state.checking');
            try {
                await this.service.remoteMounts!.checkDraft({ name, endpoint: endpoint.value.trim(), username: username.value.trim() }, password.value, connection?.id, { signal, timeoutMs: 5000 });
                signal.throwIfAborted();
                status.textContent = t('remote.checkSuccess');
            } catch (error) { if (!signal.aborted) status.textContent = remoteConnectionError(error); throw error; }
        };
        this.button(fields, t('remote.check'), async () => {
            const name = fields.closest('form')?.querySelector('input')?.value.trim() || connection?.name || 'check';
            try { await validate(name); } catch { /* The inline status owns validation errors. */ }
        });
        fields.append(status);
        fields.oninput = () => { check?.abort(); status.textContent = ''; };
        return validate;
    }
    private input(parent: HTMLElement, key: Parameters<typeof t>[0], value: string, type: string): HTMLInputElement {
        const label = document.createElement('label'); label.textContent = t(key);
        const input = document.createElement('input'); input.type = type; input.value = value; input.setAttribute('aria-label', t(key));
        input.autocomplete = type === 'password' ? 'current-password' : 'off'; label.append(input); parent.append(label); return input;
    }
    private button(parent: HTMLElement, label: string, run: () => Promise<void>) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
        button.onclick = async () => {
            button.disabled = true;
            try { await run(); } catch { if (!this.controller.signal.aborted) { const error = document.createElement('p'); error.textContent = t('remote.connectionFailed'); parent.append(error); } }
            finally { button.disabled = false; }
        };
        parent.append(button);
    }
    async destroy(): Promise<void> { this.controller.abort(); this.unsubscribe?.(); await super.destroy(); }
}
