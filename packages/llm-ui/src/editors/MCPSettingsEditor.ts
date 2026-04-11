// @file llm-ui/editors/MCPSettingsEditor.ts
import {
    BaseSettingsEditor, Toast, Modal, generateShortUUID,
    t, MCP_TRANSPORT_ICONS, STATUS_META, ENTITY_ICONS,
} from '@itookit/common';
import type { MCPServer, IAgentManagementService } from '@itookit/common';

// ─── helpers ──────────────────────────────────────────────────────────────────

function statusDot(status?: MCPServer['status']): string {
    const s = STATUS_META[status as keyof typeof STATUS_META] ?? STATUS_META.idle;
    const label = t(`status.${status ?? 'idle'}` as Parameters<typeof t>[0]);
    return `<span style="color:${s.color};font-size:.75rem">${s.dot} ${label}</span>`;
}

function statusBadge(status?: MCPServer['status']): string {
    if (status === 'connected')
        return `<span class="settings-badge settings-badge--success">${STATUS_META.connected.dot} ${t('status.connected')}</span>`;
    if (status === 'error')
        return `<span class="settings-badge settings-badge--danger">✕ ${t('status.error')}</span>`;
    return `<span class="settings-badge">${STATUS_META.idle.dot} ${t('status.idle')}</span>`;
}

// ─── MCPSettingsEditor ────────────────────────────────────────────────────────

export class MCPSettingsEditor extends BaseSettingsEditor<IAgentManagementService> {
    private selectedId: string | null = null;

    async render() {
        const servers = await this.service.getMCPServers();

        if (this.selectedId && !servers.find(s => s.id === this.selectedId)) {
            this.selectedId = null;
        }
        if (!this.selectedId && servers.length > 0) {
            this.selectedId = servers[0].id;
        }

        const selected = servers.find(s => s.id === this.selectedId) ?? null;

        this.container.innerHTML = `
            <div class="settings-split">
                <div class="settings-split__sidebar">
                    <div class="settings-split__header">
                        <h3 style="margin:0;font-size:.9375rem;font-weight:600">
                            <i class="fas fa-plug" style="margin-right:.5rem;opacity:.7"></i>MCP Servers
                        </h3>
                        <div class="settings-page__actions">
                            <button class="settings-btn-round" data-action="add"    title="${t('mcp.addNew')}"><i class="fas fa-plus"></i></button>
                            <button class="settings-btn-round" data-action="import" title="${t('mcp.importConfig')}"><i class="fas fa-file-import"></i></button>
                            <button class="settings-btn-round" data-action="export" title="${t('mcp.exportAll')}"><i class="fas fa-file-export"></i></button>
                        </div>
                    </div>
                    <div class="settings-split__list">
                        ${servers.length === 0 ? this.renderEmptyList() : servers.map(s => this.renderListItem(s)).join('')}
                    </div>
                </div>
                <div class="settings-split__content">
                    ${selected ? this.renderDetail(selected) : this.renderEmptyState()}
                </div>
            </div>`;

        this.bindEvents(servers);
    }

    // ─── List ───────────────────────────────────────────────────────────────

    private renderEmptyList() {
        return `
            <div class="settings-empty settings-empty--mini">
                <div class="settings-empty__icon" style="font-size:2rem">🔌</div>
                <p style="margin:.5rem 0">${t('mcp.empty.text')}</p>
                <button class="settings-btn settings-btn--primary settings-btn--sm" data-action="add">
                    <i class="fas fa-plus"></i> ${t('mcp.empty.action')}
                </button>
            </div>`;
    }

    private renderListItem(server: MCPServer) {
        const isSelected = server.id === this.selectedId;
        const transportIcon = MCP_TRANSPORT_ICONS[server.transport as keyof typeof MCP_TRANSPORT_ICONS] ?? '🌐';
        return `
            <div class="settings-list-item ${isSelected ? 'selected' : ''}" data-id="${server.id}" style="cursor:pointer">
                <span class="settings-list-item__icon" style="font-size:1.25rem">${server.icon || ENTITY_ICONS.mcp}</span>
                <div class="settings-list-item__info" style="min-width:0">
                    <div class="settings-list-item__title" data-name-for="${server.id}"
                         title="${t('tooltip.dblClickRename')}" style="cursor:text">${server.name}</div>
                    <div class="settings-list-item__desc">
                        ${transportIcon} ${t(`mcpTransport.${server.transport}` as Parameters<typeof t>[0]) ?? server.transport}
                    </div>
                </div>
                ${statusDot(server.status)}
            </div>`;
    }

    // ─── Detail ─────────────────────────────────────────────────────────────

    private renderDetail(server: MCPServer) {
        const tools     = (server.tools     as any[] | undefined) ?? [];
        const resources = (server.resources as any[] | undefined) ?? [];

        return `
            <!-- ── Header ── -->
            <div style="padding:1.25rem 1.75rem;border-bottom:1px solid var(--st-border-color);
                        display:flex;align-items:center;justify-content:space-between;gap:.75rem;flex-wrap:wrap">
                <div style="display:flex;align-items:center;gap:1rem;min-width:0">
                    <span style="font-size:2.25rem;flex-shrink:0;line-height:1">${server.icon || ENTITY_ICONS.mcp}</span>
                    <div style="min-width:0">
                        <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">
                            <input name="header-name" value="${server.name}"
                                placeholder="${t('mcp.placeholder.name')}"
                                style="font-size:1.125rem;font-weight:700;color:var(--st-text-primary);
                                       background:transparent;border:0;border-bottom:2px solid transparent;
                                       outline:none;padding:0 0 1px;font-family:inherit;
                                       width:auto;min-width:60px;max-width:280px;cursor:text;
                                       transition:border-color .15s"
                                title="${t('tooltip.clickEditName')}">
                            ${statusBadge(server.status)}
                        </div>
                        <div style="font-size:.8125rem;color:var(--st-text-secondary);margin-top:.125rem">
                            ${server.description || t(`mcpTransport.${server.transport}` as Parameters<typeof t>[0]) || server.transport}
                        </div>
                    </div>
                </div>
                <div style="display:flex;gap:.5rem;flex-shrink:0">
                    <button class="settings-btn settings-btn--secondary" data-action="test">
                        <i class="fas fa-plug"></i> ${t('action.test')}
                    </button>
                    <button class="settings-btn settings-btn--primary" data-action="save">
                        <i class="fas fa-save"></i> ${t('action.save')}
                    </button>
                    <button class="settings-btn settings-btn--danger" data-action="delete" title="${t('action.delete')}">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>

            <!-- ── Scrollable body ── -->
            <div style="overflow-y:auto;padding:1.25rem 1.75rem 2rem">

                <!-- Basic Info -->
                <div class="settings-section">
                    <h3 class="settings-section__title">${t('mcp.section.basic')}</h3>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
                        <div class="settings-form-group">
                            <label>${t('form.name')}</label>
                            <input class="settings-input" name="name" value="${server.name}" placeholder="${t('mcp.placeholder.name')}">
                        </div>
                        <div class="settings-form-group">
                            <label>${t('form.icon')} <span style="color:var(--st-text-tertiary);font-size:.8em">emoji</span></label>
                            <input class="settings-input" name="icon" value="${server.icon || ''}" placeholder="🔌">
                        </div>
                    </div>
                    <div class="settings-form-group">
                        <label>${t('form.description')}</label>
                        <textarea class="settings-textarea" name="description" rows="2"
                            placeholder="${t('mcp.placeholder.desc')}">${server.description || ''}</textarea>
                    </div>
                </div>

                <!-- Transport -->
                <div class="settings-section">
                    <h3 class="settings-section__title">${t('mcp.section.transport')}</h3>
                    <div class="settings-form-group">
                        <label>${t('mcp.transport.label')}</label>
                        <select class="settings-select" name="transport" id="transport-select">
                            <option value="stdio" ${server.transport === 'stdio' ? 'selected' : ''}>${MCP_TRANSPORT_ICONS.stdio} ${t('mcpTransport.stdio.option')}</option>
                            <option value="sse"   ${server.transport === 'sse'   ? 'selected' : ''}>${MCP_TRANSPORT_ICONS.sse} ${t('mcpTransport.sse.option')}</option>
                            <option value="http"  ${server.transport === 'http'  ? 'selected' : ''}>${MCP_TRANSPORT_ICONS.http} ${t('mcpTransport.http.option')}</option>
                        </select>
                    </div>
                    <div id="transport-fields">
                        ${this.renderTransportFields(server)}
                    </div>
                </div>

                <!-- Advanced -->
                <div class="settings-section">
                    <h3 class="settings-section__title">${t('mcp.section.advanced')}</h3>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;align-items:end">
                        <div class="settings-form-group" style="margin-bottom:0">
                            <label>${t('form.timeout')}</label>
                            <input class="settings-input" type="number" name="timeout"
                                value="${server.timeout ?? 30}" min="5" max="300">
                        </div>
                        <div class="settings-checkbox-row" style="padding-bottom:.5rem">
                            <input type="checkbox" id="auto-connect" name="autoConnect"
                                ${server.autoConnect ? 'checked' : ''}>
                            <label for="auto-connect">${t('form.autoConnect')}</label>
                        </div>
                    </div>
                </div>

                <!-- Tools -->
                <div class="settings-section">
                    <h3 class="settings-section__title" style="display:flex;align-items:center;gap:.5rem">
                        Tools
                        <span class="settings-badge">${tools.length}</span>
                        <button class="settings-btn settings-btn--sm" data-action="add-tool"
                            style="margin-left:auto;font-size:.75rem">${t('mcp.tools.addBtn')}</button>
                    </h3>
                    <p style="font-size:.75rem;color:var(--st-text-tertiary);margin:0 0 .5rem">
                        ${t('mcp.tools.hint')}
                    </p>
                    ${tools.length > 0 ? this.renderToolList(tools) : `
                        <div class="settings-empty settings-empty--mini">
                            <p style="color:var(--st-text-tertiary);font-size:.875rem">${t('mcp.tools.empty')}</p>
                        </div>`}
                </div>

                <!-- Resources -->
                <div class="settings-section" style="margin-bottom:0">
                    <h3 class="settings-section__title" style="display:flex;align-items:center;gap:.5rem">
                        Resources
                        <span class="settings-badge">${resources.length}</span>
                        <button class="settings-btn settings-btn--sm" data-action="add-resource"
                            style="margin-left:auto;font-size:.75rem">${t('mcp.resources.addBtn')}</button>
                    </h3>
                    ${resources.length > 0 ? this.renderResourceList(resources) : `
                        <div class="settings-empty settings-empty--mini">
                            <p style="color:var(--st-text-tertiary);font-size:.875rem">${t('mcp.resources.empty')}</p>
                        </div>`}
                </div>
            </div>`;
    }

    private renderTransportFields(server: MCPServer) {
        if (server.transport === 'stdio') {
            return `
                <div class="settings-form-group">
                    <label>${t('mcp.command.label')} <span style="color:var(--st-text-tertiary);font-size:.8em">${t('mcp.command.hint')}</span></label>
                    <input class="settings-input" name="command" value="${server.command || ''}"
                        placeholder="${t('mcp.placeholder.command')}" style="font-family:monospace">
                </div>
                <div class="settings-form-group">
                    <label>${t('mcp.args.label')} <span style="color:var(--st-text-tertiary);font-size:.8em">${t('mcp.args.hint')}</span></label>
                    <input class="settings-input" name="args" value="${server.args || ''}"
                        placeholder="${t('mcp.placeholder.args')}" style="font-family:monospace">
                </div>
                <div class="settings-form-group">
                    <label>${t('mcp.cwd.label')} <span style="color:var(--st-text-tertiary);font-size:.8em">${t('mcp.cwd.hint')}</span></label>
                    <input class="settings-input" name="cwd" value="${server.cwd || ''}"
                        placeholder="${t('mcp.placeholder.cwd')}" style="font-family:monospace">
                </div>`;
        }
        return `
            <div class="settings-form-group">
                <label>Endpoint URL</label>
                <input class="settings-input" type="url" name="endpoint" value="${server.endpoint || ''}"
                    placeholder="${t('mcp.placeholder.endpoint')}">
            </div>
            <div class="settings-form-group">
                <label>${t('mcp.apiKey.label')} <span style="color:var(--st-text-tertiary);font-size:.8em">${t('mcp.apiKey.hint')}</span></label>
                <input class="settings-input" type="password" name="apiKey" value="${server.apiKey || ''}"
                    placeholder="${t('mcp.placeholder.apiKey')}">
            </div>`;
    }

    private renderToolList(tools: any[]) {
        return `<div style="display:flex;flex-direction:column;gap:.375rem">${
            tools.map((tool, i) => `
                <div class="settings-card" style="display:flex;align-items:center;gap:.75rem;padding:.625rem .875rem">
                    <i class="fas fa-wrench" style="color:var(--st-color-primary);flex-shrink:0;font-size:.875rem"></i>
                    <div style="flex:1;min-width:0">
                        <div style="font-weight:600;font-size:.875rem;font-family:monospace">${tool.name}</div>
                        <div style="font-size:.8125rem;color:var(--st-text-secondary);
                                    white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                            ${tool.description || t('mcp.tools.noDesc')}</div>
                    </div>
                    <button class="settings-btn-icon" data-action="del-tool" data-index="${i}" title="${t('action.delete')}">
                        <i class="fas fa-times"></i>
                    </button>
                </div>`).join('')}
        </div>`;
    }

    private renderResourceList(resources: any[]) {
        return `<div style="display:flex;flex-direction:column;gap:.375rem">${
            resources.map((r, i) => `
                <div class="settings-card" style="display:flex;align-items:center;gap:.75rem;padding:.625rem .875rem">
                    <i class="fas fa-database" style="color:var(--st-color-primary);flex-shrink:0;font-size:.875rem"></i>
                    <div style="flex:1;min-width:0">
                        <div style="font-weight:600;font-size:.875rem">${r.name || r.uri}</div>
                        <div style="font-size:.8125rem;color:var(--st-text-secondary);font-family:monospace;
                                    white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.uri}</div>
                    </div>
                    <button class="settings-btn-icon" data-action="del-resource" data-index="${i}" title="${t('action.delete')}">
                        <i class="fas fa-times"></i>
                    </button>
                </div>`).join('')}
        </div>`;
    }

    private renderEmptyState() {
        return `
            <div class="settings-empty" style="height:100%;justify-content:center">
                <div class="settings-empty__icon">${ENTITY_ICONS.mcp}</div>
                <div class="settings-empty__title">${t('mcp.select.title')}</div>
                <p style="color:var(--st-text-tertiary);font-size:.875rem;text-align:center;max-width:280px">
                    ${t('mcp.select.desc')}
                </p>
                <button class="settings-btn settings-btn--primary" data-action="add">
                    <i class="fas fa-plus"></i> ${t('mcp.select.action')}
                </button>
            </div>`;
    }

    // ─── Events ─────────────────────────────────────────────────────────────

    private bindEvents(servers: MCPServer[]) {
        this.clearListeners();

        // ── Sidebar: single click = select, double click = inline rename ──────
        const list = this.container.querySelector('.settings-split__list');
        if (list) {
            this.addEventListener(list, 'click', (e) => {
                if ((e.target as HTMLElement).closest('.mcp-inline-rename')) return;
                const item = (e.target as HTMLElement).closest('[data-id]') as HTMLElement | null;
                if (item) { this.selectedId = item.dataset.id!; this.render(); }
            });
            this.addEventListener(list, 'dblclick', (e) => {
                const titleEl = (e.target as HTMLElement).closest('[data-name-for]') as HTMLElement | null;
                if (titleEl) this.startInlineRename(titleEl, titleEl.dataset.nameFor!, servers);
            });
        }

        // ── Header name input ─────────────────────────────────────────────────
        const headerInput = this.container.querySelector<HTMLInputElement>('[name="header-name"]');
        const formInput   = this.container.querySelector<HTMLInputElement>('[name="name"]');
        if (headerInput) {
            this.addEventListener(headerInput, 'focus', () => {
                headerInput.style.borderBottomColor = 'var(--st-primary, #6366f1)';
            });
            this.addEventListener(headerInput, 'blur', () => {
                headerInput.style.borderBottomColor = 'transparent';
                this.saveNameOnly(headerInput.value.trim(), servers);
            });
            this.addEventListener(headerInput, 'keydown', (e) => {
                if ((e as KeyboardEvent).key === 'Enter') headerInput.blur();
            });
            if (formInput) {
                this.addEventListener(headerInput, 'input', () => {
                    formInput.value = headerInput.value;
                    this.resizeHeaderInput(headerInput);
                });
                this.addEventListener(formInput, 'input', () => {
                    headerInput.value = formInput.value;
                    this.resizeHeaderInput(headerInput);
                });
            }
            this.resizeHeaderInput(headerInput);
        }

        // ── Action buttons ────────────────────────────────────────────────────
        this.container.querySelectorAll('[data-action="add"]').forEach(el =>
            this.addEventListener(el, 'click', () => this.addNew()));
        this.bindAction('import',       () => this.showImport());
        this.bindAction('export',       () => this.exportAll(servers));
        this.bindAction('save',         () => this.saveCurrent(servers));
        this.bindAction('delete',       () => this.deleteCurrent());
        this.bindAction('test',         () => this.testCurrent(servers));
        this.bindAction('add-tool',     () => this.addTool(servers));
        this.bindAction('add-resource', () => this.addResource(servers));

        // ── Transport select ──────────────────────────────────────────────────
        const transportSel = this.container.querySelector<HTMLSelectElement>('#transport-select');
        if (transportSel) {
            this.addEventListener(transportSel, 'change', () => {
                const el = this.container.querySelector<HTMLElement>('#transport-fields');
                const dummy = { transport: transportSel.value } as MCPServer;
                if (el) el.innerHTML = this.renderTransportFields(dummy);
            });
        }

        // ── Dynamic delete buttons (tool / resource) ──────────────────────────
        const content = this.container.querySelector('.settings-split__content');
        if (content) {
            this.addEventListener(content, 'click', async (e) => {
                const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
                if (!btn) return;
                const action = btn.dataset.action;
                const idx    = parseInt(btn.dataset.index ?? '-1', 10);
                if (action === 'del-tool')     { await this.deleteTool(idx, servers); await this.render(); }
                if (action === 'del-resource') { await this.deleteResource(idx, servers); await this.render(); }
            });
        }
    }

    private bindAction(action: string, handler: () => void) {
        const el = this.container.querySelector(`[data-action="${action}"]`);
        if (el) this.addEventListener(el, 'click', handler);
    }

    private val(name: string) {
        return (this.container.querySelector(`[name="${name}"]`) as HTMLInputElement | null)?.value ?? '';
    }
    private chk(name: string) {
        return (this.container.querySelector(`[name="${name}"]`) as HTMLInputElement | null)?.checked ?? false;
    }

    private resizeHeaderInput(input: HTMLInputElement): void {
        input.style.width = '4px';
        input.style.width = `${Math.min(input.scrollWidth + 4, 280)}px`;
    }

    private async saveNameOnly(newName: string, servers: MCPServer[]): Promise<void> {
        if (!this.selectedId || !newName) return;
        const server = servers.find(s => s.id === this.selectedId);
        if (!server || server.name === newName) return;

        await this.service.saveMCPServer({ ...server, name: newName });

        const sidebarTitle = this.container.querySelector<HTMLElement>(`[data-name-for="${this.selectedId}"]`);
        if (sidebarTitle && !sidebarTitle.querySelector('input')) sidebarTitle.textContent = newName;
        const formInput = this.container.querySelector<HTMLInputElement>('[name="name"]');
        if (formInput) formInput.value = newName;
        // Patch local cache so subsequent saves use the new name
        server.name = newName;
    }

    private startInlineRename(titleEl: HTMLElement, serverId: string, servers: MCPServer[]): void {
        if (titleEl.querySelector('input')) return;
        const original = titleEl.textContent?.trim() ?? '';

        const input = document.createElement('input');
        input.value = original;
        input.className = 'mcp-inline-rename';
        input.style.cssText = [
            'width:100%', 'padding:0 2px', 'margin:0',
            'font-size:inherit', 'font-weight:inherit', 'font-family:inherit',
            'color:inherit', 'background:var(--st-input-bg,#fff)',
            'border:1px solid var(--st-primary,#6366f1)', 'border-radius:3px',
            'outline:none', 'line-height:1.4',
        ].join(';');

        titleEl.textContent = '';
        titleEl.appendChild(input);
        input.select();
        input.focus();

        let committed = false;
        const commit = async () => {
            if (committed) return;
            committed = true;
            const newName = input.value.trim() || original;
            titleEl.textContent = newName;
            if (newName === original) return;

            const server = servers.find(s => s.id === serverId);
            if (!server) return;
            await this.service.saveMCPServer({ ...server, name: newName });
            server.name = newName;

            if (serverId === this.selectedId) {
                const hdr = this.container.querySelector<HTMLInputElement>('[name="header-name"]');
                const frm = this.container.querySelector<HTMLInputElement>('[name="name"]');
                if (hdr) { hdr.value = newName; this.resizeHeaderInput(hdr); }
                if (frm) frm.value = newName;
            }
        };

        input.addEventListener('blur', commit, { once: true });
        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter')  { input.blur(); }
            if (e.key === 'Escape') { committed = true; titleEl.textContent = original; }
        });
    }

    // ─── Actions ────────────────────────────────────────────────────────────

    private async addNew() {
        const server: MCPServer = {
            id:        `mcp-${generateShortUUID()}`,
            name:      'New Server',
            transport: 'stdio',
            status:    'idle',
            tools:     [],
            resources: [],
        };
        await this.service.saveMCPServer(server);
        this.selectedId = server.id;
        await this.render();
    }

    private async saveCurrent(servers: MCPServer[]) {
        if (!this.selectedId) return;
        const existing = servers.find(s => s.id === this.selectedId);
        if (!existing) return;

        const transport = this.val('transport') as MCPServer['transport'];
        const updated: MCPServer = {
            ...existing,
            name:        this.val('header-name') || this.val('name') || existing.name,
            icon:        this.val('icon')        || undefined,
            description: this.val('description') || undefined,
            transport,
            // stdio
            command:     transport === 'stdio' ? (this.val('command') || undefined) : undefined,
            args:        transport === 'stdio' ? (this.val('args')    || undefined) : undefined,
            cwd:         transport === 'stdio' ? (this.val('cwd')     || undefined) : undefined,
            // http/sse
            endpoint:    transport !== 'stdio' ? (this.val('endpoint') || undefined) : undefined,
            apiKey:      transport !== 'stdio' ? (this.val('apiKey')   || undefined) : undefined,
            timeout:     parseInt(this.val('timeout')) || 30,
            autoConnect: this.chk('autoConnect'),
        };
        await this.service.saveMCPServer(updated);
        Toast.success(t('mcp.toast.saved'));
        await this.render();
    }

    private deleteCurrent() {
        if (!this.selectedId) return;
        Modal.confirm(t('dialog.delete.title'), t('mcp.confirm.delete'), async () => {
            await this.service.deleteMCPServer(this.selectedId!);
            this.selectedId = null;
            Toast.success(t('mcp.toast.deleted'));
            await this.render();
        });
    }

    private async testCurrent(servers: MCPServer[]) {
        if (!this.selectedId) return;
        const server = servers.find(s => s.id === this.selectedId);
        if (!server) return;

        const btn = this.container.querySelector<HTMLButtonElement>('[data-action="test"]');
        if (!btn) return;
        const originalHTML = btn.innerHTML;
        btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${t('status.testing')}`;
        btn.disabled = true;

        try {
            if (server.transport === 'stdio') {
                Toast.info(t('mcp.toast.testStdio'));
                return;
            }
            if (!server.endpoint) {
                Toast.error(t('mcp.toast.testNoEndpoint'));
                return;
            }
            const res = await fetch(server.endpoint, {
                method:  'GET',
                headers: server.apiKey
                    ? { Authorization: `Bearer ${server.apiKey}` }
                    : {},
                signal: AbortSignal.timeout(5000),
            });
            if (res.ok) {
                Toast.success(t('mcp.toast.testSuccess', { status: res.status }));
                // Update status
                const updated = { ...server, status: 'connected' as const };
                await this.service.saveMCPServer(updated);
                await this.render();
            } else {
                Toast.error(t('mcp.toast.testFailed', { status: res.status }));
            }
        } catch (e: unknown) {
            Toast.error(t('mcp.toast.testError', { message: (e as Error).message }));
        } finally {
            if (btn.isConnected) {
                btn.innerHTML = originalHTML;
                btn.disabled = false;
            }
        }
    }

    private async addTool(servers: MCPServer[]) {
        const body = `
            <div class="settings-form-group">
                <label>${t('mcp.addTool.nameLabel')} <span style="color:var(--st-text-tertiary);font-size:.8em">snake_case</span></label>
                <input class="settings-input" id="tool-name" placeholder="${t('mcp.addTool.namePlaceholder')}" style="font-family:monospace">
            </div>
            <div class="settings-form-group">
                <label>${t('form.description')}</label>
                <textarea class="settings-textarea" id="tool-desc" rows="2"
                    placeholder="${t('mcp.addTool.descPlaceholder')}"></textarea>
            </div>`;
        new Modal(t('mcp.addTool.title'), body, {
            onConfirm: async () => {
                const name = (document.getElementById('tool-name') as HTMLInputElement).value.trim();
                const desc = (document.getElementById('tool-desc') as HTMLTextAreaElement).value.trim();
                if (!name) return false;
                const server = servers.find(s => s.id === this.selectedId);
                if (server) {
                    server.tools = [...((server.tools as any[]) || []), { name, description: desc }];
                    await this.service.saveMCPServer(server);
                    await this.render();
                }
            },
        }).show();
    }

    private async deleteTool(index: number, servers: MCPServer[]) {
        const server = servers.find(s => s.id === this.selectedId);
        if (!server?.tools) return;
        const tools = [...(server.tools as any[])];
        tools.splice(index, 1);
        await this.service.saveMCPServer({ ...server, tools });
    }

    private async addResource(servers: MCPServer[]) {
        const body = `
            <div class="settings-form-group">
                <label>${t('mcp.addResource.uriLabel')}</label>
                <input class="settings-input" id="res-uri" placeholder="${t('mcp.addResource.uriPlaceholder')}" style="font-family:monospace">
            </div>
            <div class="settings-form-group">
                <label>${t('form.name')}</label>
                <input class="settings-input" id="res-name" placeholder="${t('mcp.addResource.namePlaceholder')}">
            </div>`;
        new Modal(t('mcp.addResource.title'), body, {
            onConfirm: async () => {
                const uri  = (document.getElementById('res-uri')  as HTMLInputElement).value.trim();
                const name = (document.getElementById('res-name') as HTMLInputElement).value.trim();
                if (!uri) return false;
                const server = servers.find(s => s.id === this.selectedId);
                if (server) {
                    server.resources = [...((server.resources as any[]) || []), { uri, name }];
                    await this.service.saveMCPServer(server);
                    await this.render();
                }
            },
        }).show();
    }

    private async deleteResource(index: number, servers: MCPServer[]) {
        const server = servers.find(s => s.id === this.selectedId);
        if (!server?.resources) return;
        const resources = [...(server.resources as any[])];
        resources.splice(index, 1);
        await this.service.saveMCPServer({ ...server, resources });
    }

    private showImport() {
        const body = `
            <p style="font-size:.875rem;color:var(--st-text-secondary);margin:0 0 .75rem">
                ${t('mcp.import.hint')}</p>
            <textarea class="settings-textarea" id="import-json" rows="8"
                placeholder="${t('mcp.import.placeholder')}"
                style="font-family:monospace;font-size:.8125rem"></textarea>`;
        new Modal(t('mcp.import.title'), body, {
            confirmText: t('dialog.import.action'),
            onConfirm: async () => {
                const text = (document.getElementById('import-json') as HTMLTextAreaElement).value;
                try {
                    const data = JSON.parse(text);
                    const arr: MCPServer[] = Array.isArray(data) ? data : [data];
                    for (const item of arr) {
                        item.id = item.id || `mcp-${generateShortUUID()}`;
                        await this.service.saveMCPServer(item);
                    }
                    Toast.success(t('mcp.toast.imported', { count: arr.length }));
                    if (arr.length > 0) this.selectedId = arr[arr.length - 1].id;
                    await this.render();
                } catch {
                    Toast.error(t('mcp.toast.invalidJson'));
                    return false;
                }
            },
        }).show();
    }

    private async exportAll(servers: MCPServer[]) {
        // Remove apiKey from export for security
        const safe = servers.map(({ apiKey: _k, ...rest }) => rest);
        const blob = new Blob([JSON.stringify(safe, null, 2)], { type: 'application/json' });
        const a = Object.assign(document.createElement('a'), {
            href: URL.createObjectURL(blob), download: 'mcp-servers.json',
        });
        a.click();
        URL.revokeObjectURL(a.href);
    }
}
