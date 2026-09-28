import { BaseSettingsEditor, type EditorOptions } from '@itookit/ui-common';
import type { ProjectService, RemoteFileSystemConfig } from '@itookit/app-core';
import { ENTITY_ICONS, t } from '@itookit/common';
import { showNameDialog } from './project-dialog';

/** Connections are shared by projects; passwords stay in the host credential provider. */
export class RemoteFilesSettingsEditor extends BaseSettingsEditor<ProjectService> {
    private readonly controller = new AbortController();
    private unsubscribe?: () => void;
    constructor(container: HTMLElement, service: ProjectService, options: EditorOptions) { super(container, service, options); }
    async init(container: HTMLElement) {
        await super.init(container);
        this.unsubscribe = this.service.remoteMounts?.onChange(() => { void this.render(); });
    }
    async render(): Promise<void> {
        if (this.controller.signal.aborted) return;
        const page = document.createElement('div'); page.className = 'settings-section';
        const title = document.createElement('h2'); title.textContent = `${ENTITY_ICONS.remoteProject} ${t('remote.settings')}`;
        const hint = document.createElement('p'); hint.textContent = t('remote.settingsHint'); page.append(title, hint);
        this.button(page, t('remote.connectionAdd'), () => this.edit());
        const connections = this.service.remoteMounts?.connections() ?? [];
        for (const connection of connections) {
            const row = document.createElement('section'); row.className = 'remote-settings__project';
            const label = document.createElement('h3'); label.textContent = connection.name;
            const address = document.createElement('p'); address.textContent = `${connection.endpoint} · ${connection.username} · ${t(`remote.state.${this.service.remoteMounts!.connectionStatus(connection.id)}`)}`; row.append(label, address);
            this.button(row, t('remote.connectionEdit'), () => this.edit(connection));
            this.button(row, t('remote.connectionRemove'), async () => { await this.service.remoteMounts!.removeConnection(connection.id); });
            this.button(row, t('remote.check'), () => this.service.remoteMounts!.checkConnection(connection.id, { signal: this.controller.signal, timeoutMs: 3000 }));
            page.append(row);
        }
        if (!connections.length) { const empty = document.createElement('p'); empty.textContent = t('remote.connectionEmpty'); page.append(empty); }
        this.container.replaceChildren(page);
    }
    private async edit(connection?: RemoteFileSystemConfig): Promise<void> {
        const fields = document.createElement('div');
        const endpoint = this.input(fields, 'remote.endpoint', connection?.endpoint ?? '', 'text'); endpoint.placeholder = '127.0.0.1:8787';
        const username = this.input(fields, 'remote.username', connection?.username ?? '', 'text');
        const password = this.input(fields, 'remote.password', '', 'password');
        const hint = document.createElement('p'); hint.textContent = t('remote.connectionHint'); fields.append(hint);
        try {
            await showNameDialog(t(connection ? 'remote.connectionEdit' : 'remote.connectionAdd'), t('remote.connectionName'), this.controller.signal, async name => {
                try { await this.service.remoteMounts!.saveConnection({ name, endpoint: endpoint.value.trim(), username: username.value.trim() }, password.value, connection?.id); }
                catch { throw new Error(t('remote.connectionFailed')); }
            }, fields, { initialName: connection?.name, confirmLabel: t('remote.connectionSave') });
        } finally { password.value = ''; }
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
