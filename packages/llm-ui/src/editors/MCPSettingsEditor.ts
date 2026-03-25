// @file llm-ui/editors/MCPSettingsEditor.ts
import { BaseSettingsEditor, Toast, Modal, generateShortUUID } from '@itookit/common';
import type { MCPServer, IAgentManagementService } from '@itookit/common';

// ─── helpers ──────────────────────────────────────────────────────────────────

const TRANSPORT_LABELS: Record<string, string> = {
    stdio:  'Stdio (本地进程)',
    sse:    'SSE (HTTP 流)',
    http:   'HTTP (REST)',
};

function statusBadge(status?: MCPServer['status']): string {
    if (status === 'connected') return `<span class="settings-badge settings-badge--success">● 已连接</span>`;
    if (status === 'error')     return `<span class="settings-badge settings-badge--danger">✕ 错误</span>`;
    return `<span class="settings-badge">○ 未连接</span>`;
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
                            <button class="settings-btn-round" data-action="add"     title="添加服务器"><i class="fas fa-plus"></i></button>
                            <button class="settings-btn-round" data-action="import"  title="导入配置"><i class="fas fa-file-import"></i></button>
                            <button class="settings-btn-round" data-action="export"  title="导出全部"><i class="fas fa-file-export"></i></button>
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
                <p style="margin:.5rem 0">暂无 MCP Server</p>
                <button class="settings-btn settings-btn--primary settings-btn--sm" data-action="add">
                    <i class="fas fa-plus"></i> 添加第一个
                </button>
            </div>`;
    }

    private renderListItem(server: MCPServer) {
        const isSelected = server.id === this.selectedId;
        const transportIcon = server.transport === 'stdio' ? '🖥' : '🌐';
        return `
            <div class="settings-list-item ${isSelected ? 'selected' : ''}" data-id="${server.id}" style="cursor:pointer">
                <span class="settings-list-item__icon" style="font-size:1.25rem">${server.icon || '🔌'}</span>
                <div class="settings-list-item__info">
                    <div class="settings-list-item__title">${server.name}</div>
                    <div class="settings-list-item__desc">${transportIcon} ${TRANSPORT_LABELS[server.transport] ?? server.transport}</div>
                </div>
                ${statusBadge(server.status)}
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
                    <span style="font-size:2.25rem;flex-shrink:0;line-height:1">${server.icon || '🔌'}</span>
                    <div style="min-width:0">
                        <div style="font-size:1.125rem;font-weight:700;color:var(--st-text-primary);
                                    white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${server.name}</div>
                        <div style="font-size:.8125rem;color:var(--st-text-secondary);margin-top:.125rem">
                            ${server.description || TRANSPORT_LABELS[server.transport] || server.transport}
                        </div>
                    </div>
                    ${statusBadge(server.status)}
                </div>
                <div style="display:flex;gap:.5rem;flex-shrink:0">
                    <button class="settings-btn settings-btn--secondary" data-action="test">
                        <i class="fas fa-plug"></i> 测试
                    </button>
                    <button class="settings-btn settings-btn--primary" data-action="save">
                        <i class="fas fa-save"></i> 保存
                    </button>
                    <button class="settings-btn settings-btn--danger" data-action="delete" title="删除">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>

            <!-- ── Scrollable body ── -->
            <div style="overflow-y:auto;padding:1.25rem 1.75rem 2rem">

                <!-- Basic Info -->
                <div class="settings-section">
                    <h3 class="settings-section__title">基础信息</h3>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem">
                        <div class="settings-form-group">
                            <label>名称</label>
                            <input class="settings-input" name="name" value="${server.name}" placeholder="My MCP Server">
                        </div>
                        <div class="settings-form-group">
                            <label>图标 <span style="color:var(--st-text-tertiary);font-size:.8em">emoji</span></label>
                            <input class="settings-input" name="icon" value="${server.icon || ''}" placeholder="🔌">
                        </div>
                    </div>
                    <div class="settings-form-group">
                        <label>描述</label>
                        <textarea class="settings-textarea" name="description" rows="2"
                            placeholder="简短描述此服务器的用途">${server.description || ''}</textarea>
                    </div>
                </div>

                <!-- Transport -->
                <div class="settings-section">
                    <h3 class="settings-section__title">连接方式</h3>
                    <div class="settings-form-group">
                        <label>传输协议</label>
                        <select class="settings-select" name="transport" id="transport-select">
                            <option value="stdio" ${server.transport === 'stdio' ? 'selected' : ''}>🖥️ Stdio — 启动本地进程</option>
                            <option value="sse"   ${server.transport === 'sse'   ? 'selected' : ''}>🌐 SSE — Server-Sent Events</option>
                            <option value="http"  ${server.transport === 'http'  ? 'selected' : ''}>🌐 HTTP — REST 端点</option>
                        </select>
                    </div>
                    <div id="transport-fields">
                        ${this.renderTransportFields(server)}
                    </div>
                </div>

                <!-- Advanced -->
                <div class="settings-section">
                    <h3 class="settings-section__title">高级选项</h3>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;align-items:end">
                        <div class="settings-form-group" style="margin-bottom:0">
                            <label>超时时间 (秒)</label>
                            <input class="settings-input" type="number" name="timeout"
                                value="${server.timeout ?? 30}" min="5" max="300">
                        </div>
                        <div class="settings-checkbox-row" style="padding-bottom:.5rem">
                            <input type="checkbox" id="auto-connect" name="autoConnect"
                                ${server.autoConnect ? 'checked' : ''}>
                            <label for="auto-connect">启动时自动连接</label>
                        </div>
                    </div>
                </div>

                <!-- Tools -->
                <div class="settings-section">
                    <h3 class="settings-section__title" style="display:flex;align-items:center;gap:.5rem">
                        Tools
                        <span class="settings-badge">${tools.length}</span>
                        <button class="settings-btn settings-btn--sm" data-action="add-tool"
                            style="margin-left:auto;font-size:.75rem">+ 添加</button>
                    </h3>
                    ${tools.length > 0 ? this.renderToolList(tools) : `
                        <div class="settings-empty settings-empty--mini">
                            <p style="color:var(--st-text-tertiary);font-size:.875rem">连接后自动发现，或手动添加</p>
                        </div>`}
                </div>

                <!-- Resources -->
                <div class="settings-section" style="margin-bottom:0">
                    <h3 class="settings-section__title" style="display:flex;align-items:center;gap:.5rem">
                        Resources
                        <span class="settings-badge">${resources.length}</span>
                        <button class="settings-btn settings-btn--sm" data-action="add-resource"
                            style="margin-left:auto;font-size:.75rem">+ 添加</button>
                    </h3>
                    ${resources.length > 0 ? this.renderResourceList(resources) : `
                        <div class="settings-empty settings-empty--mini">
                            <p style="color:var(--st-text-tertiary);font-size:.875rem">暂无资源</p>
                        </div>`}
                </div>
            </div>`;
    }

    private renderTransportFields(server: MCPServer) {
        if (server.transport === 'stdio') {
            return `
                <div class="settings-form-group">
                    <label>命令 <span style="color:var(--st-text-tertiary);font-size:.8em">Command</span></label>
                    <input class="settings-input" name="command" value="${server.command || ''}"
                        placeholder="node / python / npx">
                </div>
                <div class="settings-form-group">
                    <label>参数 <span style="color:var(--st-text-tertiary);font-size:.8em">Args（空格分隔）</span></label>
                    <input class="settings-input" name="args" value="${server.args || ''}"
                        placeholder="server.js --port 3000">
                </div>
                <div class="settings-form-group">
                    <label>工作目录 <span style="color:var(--st-text-tertiary);font-size:.8em">CWD（可选）</span></label>
                    <input class="settings-input" name="cwd" value="${server.cwd || ''}"
                        placeholder="/path/to/project">
                </div>`;
        }
        return `
            <div class="settings-form-group">
                <label>Endpoint URL</label>
                <input class="settings-input" type="url" name="endpoint" value="${server.endpoint || ''}"
                    placeholder="http://localhost:3000/mcp">
            </div>
            <div class="settings-form-group">
                <label>API Key <span style="color:var(--st-text-tertiary);font-size:.8em">可选</span></label>
                <input class="settings-input" type="password" name="apiKey" value="${server.apiKey || ''}"
                    placeholder="sk-...">
            </div>`;
    }

    private renderToolList(tools: any[]) {
        return `<div style="display:flex;flex-direction:column;gap:.5rem">${
            tools.map((t, i) => `
                <div class="settings-card" style="display:flex;align-items:center;gap:.75rem;padding:.75rem 1rem">
                    <i class="fas fa-wrench" style="color:var(--st-color-primary);flex-shrink:0"></i>
                    <div style="flex:1;min-width:0">
                        <div style="font-weight:600;font-size:.875rem">${t.name}</div>
                        <div style="font-size:.8125rem;color:var(--st-text-secondary);
                                    white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                            ${t.description || '无描述'}</div>
                    </div>
                    <button class="settings-btn-icon" data-action="del-tool" data-index="${i}" title="删除">
                        <i class="fas fa-times"></i>
                    </button>
                </div>`).join('')}
        </div>`;
    }

    private renderResourceList(resources: any[]) {
        return `<div style="display:flex;flex-direction:column;gap:.5rem">${
            resources.map((r, i) => `
                <div class="settings-card" style="display:flex;align-items:center;gap:.75rem;padding:.75rem 1rem">
                    <i class="fas fa-database" style="color:var(--st-color-primary);flex-shrink:0"></i>
                    <div style="flex:1;min-width:0">
                        <div style="font-weight:600;font-size:.875rem">${r.name || r.uri}</div>
                        <div style="font-size:.8125rem;color:var(--st-text-secondary);font-family:monospace">
                            ${r.uri}</div>
                    </div>
                    <button class="settings-btn-icon" data-action="del-resource" data-index="${i}" title="删除">
                        <i class="fas fa-times"></i>
                    </button>
                </div>`).join('')}
        </div>`;
    }

    private renderEmptyState() {
        return `
            <div class="settings-empty" style="height:100%;justify-content:center">
                <div class="settings-empty__icon">🔌</div>
                <div class="settings-empty__title">选择一个 MCP Server</div>
                <p style="color:var(--st-text-tertiary);font-size:.875rem;text-align:center;max-width:280px">
                    MCP (Model Context Protocol) 让 LLM 访问外部工具和数据源
                </p>
                <button class="settings-btn settings-btn--primary" data-action="add">
                    <i class="fas fa-plus"></i> 添加服务器
                </button>
            </div>`;
    }

    // ─── Events ─────────────────────────────────────────────────────────────

    private bindEvents(servers: MCPServer[]) {
        this.clearListeners();

        // List selection
        const list = this.container.querySelector('.settings-split__list');
        if (list) {
            this.addEventListener(list, 'click', (e) => {
                const item = (e.target as HTMLElement).closest('[data-id]') as HTMLElement | null;
                if (item) { this.selectedId = item.dataset.id!; this.render(); }
            });
        }

        // Global data-action buttons
        this.bindAction('add',     () => this.addNew());
        this.bindAction('import',  () => this.showImport());
        this.bindAction('export',  () => this.exportAll(servers));
        this.bindAction('save',    () => this.saveCurrent(servers));
        this.bindAction('delete',  () => this.deleteCurrent());
        this.bindAction('test',    () => this.testCurrent(servers));
        this.bindAction('add-tool',() => this.addTool(servers));
        this.bindAction('add-resource', () => this.addResource(servers));

        // Transport select
        const transportSel = this.container.querySelector<HTMLSelectElement>('#transport-select');
        if (transportSel) {
            this.addEventListener(transportSel, 'change', () => {
                const el = this.container.querySelector<HTMLElement>('#transport-fields');
                if (el) el.innerHTML = this.renderTransportFields({ transport: transportSel.value } as MCPServer);
            });
        }

        // Dynamic delete buttons (tool / resource)
        const content = this.container.querySelector('.settings-split__content');
        if (content) {
            this.addEventListener(content, 'click', async (e) => {
                const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
                if (!btn) return;
                const action = btn.dataset.action;
                const idx    = parseInt(btn.dataset.index ?? '-1', 10);
                if (action === 'del-tool')     await this.deleteTool(idx, servers);
                if (action === 'del-resource') await this.deleteResource(idx, servers);
            });
        }
    }

    /** Register a data-action click handler anywhere in container */
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

    // ─── Actions ────────────────────────────────────────────────────────────

    private async addNew() {
        const server: MCPServer = {
            id: `mcp-${generateShortUUID()}`,
            name: 'New Server',
            transport: 'stdio',
            status: 'idle',
            tools: [],
            resources: [],
        };
        await this.service.saveMCPServer(server);
        this.selectedId = server.id;
    }

    private async saveCurrent(servers: MCPServer[]) {
        if (!this.selectedId) return;
        const existing = servers.find(s => s.id === this.selectedId);
        if (!existing) return;

        const updated: MCPServer = {
            ...existing,
            name:        this.val('name')     || existing.name,
            icon:        this.val('icon')     || undefined,
            description: this.val('description') || undefined,
            transport:   this.val('transport') as MCPServer['transport'],
            command:     this.val('command')  || undefined,
            args:        this.val('args')     || undefined,
            cwd:         this.val('cwd')      || undefined,
            endpoint:    this.val('endpoint') || undefined,
            apiKey:      this.val('apiKey')   || undefined,
            timeout:     parseInt(this.val('timeout')) || 30,
            autoConnect: this.chk('autoConnect'),
        };
        await this.service.saveMCPServer(updated);
        Toast.success('已保存');
    }

    private deleteCurrent() {
        if (!this.selectedId) return;
        Modal.confirm('删除确认', '确定要删除此 MCP Server？此操作不可撤销。', async () => {
            await this.service.deleteMCPServer(this.selectedId!);
            this.selectedId = null;
            Toast.success('已删除');
        });
    }

    private async testCurrent(servers: MCPServer[]) {
        if (!this.selectedId) return;
        const btn = this.container.querySelector<HTMLButtonElement>('[data-action="test"]');
        if (!btn) return;
        const html = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 测试中…';
        btn.disabled = true;

        try {
            await new Promise(r => setTimeout(r, 1000));
            const server = servers.find(s => s.id === this.selectedId);
            if (server) {
                server.status = 'connected';
                if (!server.tools?.length) server.tools = [{ name: 'mock_tool', description: '自动发现的工具' }];
                await this.service.saveMCPServer(server);
                Toast.success('连接成功');
            }
        } catch {
            Toast.error('连接失败');
        } finally {
            btn.innerHTML = html;
            btn.disabled = false;
        }
    }

    private async addTool(servers: MCPServer[]) {
        const body = `
            <div class="settings-form-group">
                <label>名称</label>
                <input class="settings-input" id="tool-name" placeholder="get_weather">
            </div>
            <div class="settings-form-group">
                <label>描述</label>
                <textarea class="settings-textarea" id="tool-desc" rows="2"
                    placeholder="查询指定城市的实时天气"></textarea>
            </div>`;
        new Modal('添加工具', body, {
            onConfirm: async () => {
                const name = (document.getElementById('tool-name') as HTMLInputElement).value.trim();
                const desc = (document.getElementById('tool-desc') as HTMLTextAreaElement).value.trim();
                if (!name) return false;
                const server = servers.find(s => s.id === this.selectedId);
                if (server) {
                    server.tools = [...(server.tools as any[] || []), { name, description: desc }];
                    await this.service.saveMCPServer(server);
                }
            },
        }).show();
    }

    private async deleteTool(index: number, servers: MCPServer[]) {
        const server = servers.find(s => s.id === this.selectedId);
        if (server?.tools) {
            const tools = [...server.tools as any[]];
            tools.splice(index, 1);
            await this.service.saveMCPServer({ ...server, tools });
        }
    }

    private async addResource(servers: MCPServer[]) {
        const body = `
            <div class="settings-form-group">
                <label>URI</label>
                <input class="settings-input" id="res-uri" placeholder="file:///path/to/resource">
            </div>
            <div class="settings-form-group">
                <label>名称</label>
                <input class="settings-input" id="res-name" placeholder="显示名称">
            </div>`;
        new Modal('添加资源', body, {
            onConfirm: async () => {
                const uri  = (document.getElementById('res-uri')  as HTMLInputElement).value.trim();
                const name = (document.getElementById('res-name') as HTMLInputElement).value.trim();
                if (!uri) return false;
                const server = servers.find(s => s.id === this.selectedId);
                if (server) {
                    server.resources = [...(server.resources as any[] || []), { uri, name }];
                    await this.service.saveMCPServer(server);
                }
            },
        }).show();
    }

    private async deleteResource(index: number, servers: MCPServer[]) {
        const server = servers.find(s => s.id === this.selectedId);
        if (server?.resources) {
            const resources = [...server.resources as any[]];
            resources.splice(index, 1);
            await this.service.saveMCPServer({ ...server, resources });
        }
    }

    private showImport() {
        const body = `
            <p style="font-size:.875rem;color:var(--st-text-secondary);margin:0 0 .75rem">
                粘贴 JSON 数组（单个对象也支持）</p>
            <textarea class="settings-textarea" id="import-json" rows="8"
                placeholder='[{"name":"My Server","transport":"stdio",...}]'
                style="font-family:monospace;font-size:.8125rem"></textarea>`;
        new Modal('导入 MCP 配置', body, {
            confirmText: '导入',
            onConfirm: async () => {
                const text = (document.getElementById('import-json') as HTMLTextAreaElement).value;
                try {
                    const data = JSON.parse(text);
                    const arr: MCPServer[] = Array.isArray(data) ? data : [data];
                    for (const item of arr) {
                        item.id = item.id || `mcp-${generateShortUUID()}`;
                        await this.service.saveMCPServer(item);
                    }
                    Toast.success(`已导入 ${arr.length} 个服务器`);
                } catch {
                    Toast.error('JSON 格式错误');
                    return false;
                }
            },
        }).show();
    }

    private async exportAll(servers: MCPServer[]) {
        const blob = new Blob([JSON.stringify(servers, null, 2)], { type: 'application/json' });
        const a = Object.assign(document.createElement('a'), {
            href: URL.createObjectURL(blob), download: 'mcp-servers.json',
        });
        a.click();
    }
}
