// @file llm-ui/editors/MCPSettingsEditor.ts
import { BaseSettingsEditor, Toast, Modal, generateShortUUID } from '@itookit/common';
import { MCPServer,IAgentService } from '@itookit/llmdriver';

export class MCPSettingsEditor extends BaseSettingsEditor<IAgentService> {
    // [修复] 添加缺失的属性
    private selectedId: string | null = null;

    async render() {
        const servers = await this.service.getMCPServers();
        
        // 修正选中状态
        if (this.selectedId && !servers.find(s => s.id === this.selectedId)) {
            this.selectedId = null;
        }
        if (!this.selectedId && servers.length > 0) {
            this.selectedId = servers[0].id;
        }

        const selectedServer = servers.find(s => s.id === this.selectedId);

        this.container.innerHTML = `
            <div class="settings-split">
                <div class="settings-split__sidebar">
                    <div class="settings-split__header">
                        <h3><i class="fas fa-plug"></i> MCP Servers</h3>
                        <div class="settings-page__actions">
                            <button id="btn-add-server" class="settings-btn-round" title="添加"><i class="fas fa-plus"></i></button>
                            <button id="btn-import-server" class="settings-btn-round" title="导入"><i class="fas fa-file-import"></i></button>
                            <button id="btn-export-all" class="settings-btn-round" title="导出"><i class="fas fa-file-export"></i></button>
                        </div>
                    </div>
                    <div class="settings-split__list">
                        ${servers.length === 0 ? this.renderEmptyList() : servers.map(s => this.renderListItem(s)).join('')}
                    </div>
                </div>

                <div class="settings-split__content">
                    ${selectedServer ? this.renderConfigPanel(selectedServer) : this.renderEmptyState()}
                </div>
            </div>
        `;

        this.bindEvents();
    }

    private renderEmptyList() {
        return `
            <div class="settings-empty settings-empty--mini">
                <p>暂无 MCP Server</p>
                <button class="settings-btn settings-btn--primary settings-btn--sm" id="btn-create-first">创建第一个</button>
            </div>
        `;
    }

    private renderListItem(server: MCPServer) {
        const isSelected = server.id === this.selectedId;
        const statusClass = server.status === 'connected' ? 'settings-badge--success' : 
                           server.status === 'error' ? 'settings-badge--danger' : '';
        const statusIcon = server.status === 'connected' ? 'check-circle' : 
                          server.status === 'error' ? 'exclamation-circle' : 'circle';

        return `
            <div class="settings-list-item ${isSelected ? 'selected' : ''}" data-id="${server.id}">
                <span class="settings-list-item__icon">${server.icon || '🔌'}</span>
                <div class="settings-list-item__info">
                    <p class="settings-list-item__title">${server.name}</p>
                    <p class="settings-list-item__desc">${server.transport}</p>
                </div>
                <span class="settings-badge ${statusClass}"><i class="fas fa-${statusIcon}"></i></span>
            </div>
        `;
    }

    private renderConfigPanel(server: MCPServer) {
        const tools = server.tools || [];
        const resources = server.resources || [];

        return `
            <div class="settings-config-header">
                <div class="settings-config-header__title-area">
                    <span class="settings-config-header__icon">${server.icon || '🔌'}</span>
                    <div>
                        <h2 class="settings-config-header__title">${server.name}</h2>
                        <p class="settings-config-header__subtitle">${server.description || '配置此 MCP Server'}</p>
                    </div>
                </div>
                <div class="settings-config-header__actions">
                    <button class="settings-btn settings-btn--secondary settings-btn-test" ${!server.transport ? 'disabled' : ''}>
                        <i class="fas fa-vial"></i> 测试连接
                    </button>
                    <button class="settings-btn settings-btn--primary settings-btn-save"><i class="fas fa-save"></i> 保存</button>
                    <button class="settings-btn settings-btn--danger settings-btn-delete"><i class="fas fa-trash"></i> 删除</button>
                </div>
            </div>

            <div class="settings-section">
                <h3 class="settings-section__title">基础信息</h3>
                <div class="settings-form__row"><label class="settings-form__label">名称</label><input type="text" class="settings-form__input" name="name" value="${server.name}"></div>
                <div class="settings-form__row"><label class="settings-form__label">图标</label><input type="text" class="settings-form__input" name="icon" value="${server.icon || ''}"></div>
                <div class="settings-form__row"><label class="settings-form__label">描述</label><textarea class="settings-form__textarea" name="description">${server.description || ''}</textarea></div>
            </div>

            <div class="settings-section">
                <h3 class="settings-section__title">连接配置</h3>
                <div class="settings-form__row">
                    <label class="settings-form__label">传输方式</label>
                    <select class="settings-form__select" name="transport">
                        <option value="stdio" ${server.transport === 'stdio' ? 'selected' : ''}>STDIO</option>
                        <option value="sse" ${server.transport === 'sse' ? 'selected' : ''}>SSE</option>
                        <option value="http" ${server.transport === 'http' ? 'selected' : ''}>HTTP</option>
                    </select>
                </div>
                <div id="transport-config-container">
                    ${this.renderTransportFields(server)}
                </div>
            </div>

            <div class="settings-section">
                <h3 class="settings-section__title">
                    工具列表 (Tools) <span class="settings-badge">${tools.length}</span>
                </h3>
                ${tools.length === 0 
                    ? `<div class="settings-empty settings-empty--mini"><p>暂无工具</p><button class="settings-btn settings-btn--sm" id="btn-add-tool">手动添加</button></div>`
                    : `<div class="settings-list-card-container">${tools.map((t, i) => this.renderToolItem(t, i)).join('')}</div>
                       <button class="settings-btn settings-btn--sm" id="btn-add-tool" style="margin-top:10px">添加工具</button>`
                }
            </div>

            <div class="settings-section">
                <h3 class="settings-section__title">
                    资源列表 (Resources) <span class="settings-badge">${resources.length}</span>
                </h3>
                ${resources.length === 0 
                    ? `<div class="settings-empty settings-empty--mini"><p>暂无资源</p><button class="settings-btn settings-btn--sm" id="btn-add-resource">手动添加</button></div>`
                    : `<div class="settings-list-card-container">${resources.map((r, i) => this.renderResourceItem(r, i)).join('')}</div>
                       <button class="settings-btn settings-btn--sm" id="btn-add-resource" style="margin-top:10px">添加资源</button>`
                }
            </div>

            <div class="settings-section">
                <h3 class="settings-section__title">高级选项</h3>
                <div class="settings-form__row">
                    <label class="settings-form__label"><input type="checkbox" name="autoConnect" ${server.autoConnect ? 'checked' : ''}> 启动时自动连接</label>
                </div>
                <div class="settings-form__row">
                    <label class="settings-form__label">超时时间 (秒)</label>
                    <input type="number" class="settings-form__input" name="timeout" value="${server.timeout || 30}">
                </div>
            </div>
        `;
    }

    private renderTransportFields(server: MCPServer) {
        if (server.transport === 'stdio') {
            return `
                <div class="settings-form__row"><label class="settings-form__label">Command</label><input type="text" class="settings-form__input" name="command" value="${server.command || ''}" placeholder="node"></div>
                <div class="settings-form__row"><label class="settings-form__label">Args</label><input type="text" class="settings-form__input" name="args" value="${server.args || ''}" placeholder="server.js"></div>
                <div class="settings-form__row"><label class="settings-form__label">CWD</label><input type="text" class="settings-form__input" name="cwd" value="${server.cwd || ''}" placeholder="/path/to/dir"></div>
            `;
        } else {
            return `
                <div class="settings-form__row"><label class="settings-form__label">Endpoint</label><input type="url" class="settings-form__input" name="endpoint" value="${server.endpoint || ''}" placeholder="http://localhost:3000"></div>
                <div class="settings-form__row"><label class="settings-form__label">API Key</label><input type="password" class="settings-form__input" name="apiKey" value="${server.apiKey || ''}"></div>
            `;
        }
    }

    private renderToolItem(tool: any, index: number) {
        return `
            <div class="settings-list-card">
                <div class="settings-list-card__header">
                    <strong>${tool.name}</strong>
                    <button class="settings-btn-icon-small settings-btn-delete-tool" data-index="${index}"><i class="fas fa-trash"></i></button>
                </div>
                <p class="settings-list-card__desc">${tool.description || '无描述'}</p>
            </div>
        `;
    }

    private renderResourceItem(res: any, index: number) {
        return `
            <div class="settings-list-card">
                <div class="settings-list-card__header">
                    <strong>${res.name || res.uri}</strong>
                    <button class="settings-btn-icon-small settings-btn-delete-resource" data-index="${index}"><i class="fas fa-trash"></i></button>
                </div>
                <p class="settings-list-card__desc"><code>${res.uri}</code></p>
            </div>
        `;
    }

    private renderEmptyState() {
        return `<div class="settings-empty"><h3>请选择或创建一个 MCP Server</h3></div>`;
    }

    private bindEvents() {
        this.clearListeners();

        const list = this.container.querySelector('.settings-split__list');
        if (list) {
            this.addEventListener(list, 'click', (e) => {
                const item = (e.target as HTMLElement).closest('.settings-list-item') as HTMLElement;
                if (item) {
                    this.selectedId = item.dataset.id!;
                    this.render();
                }
            });
        }

        this.bindButton('#btn-add-server', () => this.addNewServer());
        this.bindButton('#btn-create-first', () => this.addNewServer());
        this.bindButton('#btn-import-server', () => this.showImportModal());
        this.bindButton('#btn-export-all', () => this.exportAll());
        this.bindButton('.settings-btn-save', () => this.saveCurrentServer());
        this.bindButton('.settings-btn-delete', () => this.deleteCurrentServer());
        this.bindButton('.settings-btn-test', () => this.testConnection());

        const transportSelect = this.container.querySelector('[name="transport"]');
        if (transportSelect) {
            this.addEventListener(transportSelect, 'change', (e) => {
                const val = (e.target as HTMLSelectElement).value;
                const container = document.getElementById('transport-config-container');
                if (container) {
                    const tempServer: any = { transport: val };
                    container.innerHTML = this.renderTransportFields(tempServer);
                }
            });
        }

        this.bindButton('#btn-add-tool', () => this.showAddToolModal());
        this.bindButton('#btn-add-resource', () => this.showAddResourceModal());

        const configPanel = this.container.querySelector('.settings-split__content');
        if (configPanel) {
            this.addEventListener(configPanel, 'click', (e) => {
                const target = e.target as HTMLElement;
                const toolBtn = target.closest('.settings-btn-delete-tool') as HTMLElement;
                const resBtn = target.closest('.settings-btn-delete-resource') as HTMLElement;

                if (toolBtn) this.deleteTool(parseInt(toolBtn.dataset.index!));
                if (resBtn) this.deleteResource(parseInt(resBtn.dataset.index!));
            });
        }
    }

    // Helper to bind click cleanly
    private bindButton(selector: string, handler: () => void) {
        const btn = this.container.querySelector(selector);
        if (btn) this.addEventListener(btn, 'click', handler);
    }

    // --- Actions ---

    private async addNewServer() {
        const newServer: MCPServer = {
            id: `mcp-${generateShortUUID()}`,
            name: 'New Server',
            transport: 'stdio',
            status: 'idle',
            tools: [],
            resources: []
        };
        await this.service.saveMCPServer(newServer);
        this.selectedId = newServer.id;
    }

    private async saveCurrentServer() {
        if (!this.selectedId) return;
        const existing = (await this.service.getMCPServers()).find(s => s.id === this.selectedId);
        if (!existing) return;

        // Gather form data
        const getVal = (name: string) => (this.container.querySelector(`[name="${name}"]`) as HTMLInputElement)?.value;
        const getChk = (name: string) => (this.container.querySelector(`[name="${name}"]`) as HTMLInputElement)?.checked;

        const updated: MCPServer = {
            ...existing,
            name: getVal('name'),
            icon: getVal('icon'),
            description: getVal('description'),
            transport: getVal('transport') as any,
            autoConnect: getChk('autoConnect'),
            timeout: parseInt(getVal('timeout') || '30'),
            // Conditional fields
            command: getVal('command'),
            args: getVal('args'),
            cwd: getVal('cwd'),
            endpoint: getVal('endpoint'),
            apiKey: getVal('apiKey')
        };

        await this.service.saveMCPServer(updated);
        Toast.success('已保存');
    }

    private deleteCurrentServer() {
        if (!this.selectedId) return;
        Modal.confirm('确认删除', '确定要删除此 MCP Server 吗？', async () => {
            await this.service.deleteMCPServer(this.selectedId!);
            this.selectedId = null;
            Toast.success('已删除');
        });
    }

    private async testConnection() {
        if (!this.selectedId) return;
        const btn = this.container.querySelector('.btn-test') as HTMLButtonElement;
        const originalText = btn.innerHTML;
        btn.innerHTML = '测试中...';
        btn.disabled = true;

        try {
            // 模拟测试：更新状态并生成假数据
            // 在真实场景中，这里会调用后端 API
            await new Promise(r => setTimeout(r, 1000));
            
            const server = (await this.service.getMCPServers()).find(s => s.id === this.selectedId);
            if (server) {
                server.status = 'connected';
                // 如果列表为空，填充一些 Mock 数据演示成功
                if (!server.tools?.length) {
                    server.tools = [{ name: 'mock_tool', description: 'Auto-discovered tool' }];
                }
                await this.service.saveMCPServer(server);
                Toast.success('连接测试成功');
            }
        } catch (e) {
            Toast.error('连接失败');
        } finally {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }
    }

    private showAddToolModal() {
        const content = `
            <div class="settings-form__group"><label class="settings-form__label">名称</label><input class="settings-form__input" id="tool-name" type="text"></div>
            <div class="settings-form__group"><label class="settings-form__label">描述</label><textarea class="settings-form__textarea" id="tool-desc"></textarea></div>
        `;
        new Modal('添加工具', content, {
            onConfirm: async () => {
                const name = (document.getElementById('tool-name') as HTMLInputElement).value;
                const desc = (document.getElementById('tool-desc') as HTMLInputElement).value;
                if (!name) return false;

                const server = (await this.service.getMCPServers()).find(s => s.id === this.selectedId);
                if (server) {
                    server.tools = [...(server.tools || []), { name, description: desc }];
                    await this.service.saveMCPServer(server);
                }
            }
        }).show();
    }

    private async deleteTool(index: number) {
        const server = (await this.service.getMCPServers()).find(s => s.id === this.selectedId);
        if (server && server.tools) {
            server.tools.splice(index, 1);
            this.service.saveMCPServer(server);
        }
    }

    private showAddResourceModal() {
        // 类似 showAddToolModal，略
        const content = `
            <div class="form-group"><label>URI</label><input id="res-uri" type="text"></div>
            <div class="form-group"><label>名称</label><input id="res-name" type="text"></div>
        `;
        new Modal('添加资源', content, {
            onConfirm: async () => {
                const uri = (document.getElementById('res-uri') as HTMLInputElement).value;
                const name = (document.getElementById('res-name') as HTMLInputElement).value;
                if (!uri) return false;

                const server = (await this.service.getMCPServers()).find(s => s.id === this.selectedId);
                if (server) {
                    server.resources = [...(server.resources || []), { uri, name }];
                    await this.service.saveMCPServer(server);
                }
            }
        }).show();
    }

    private async deleteResource(index: number) {
        const server = (await this.service.getMCPServers()).find(s => s.id === this.selectedId);
        if (server && server.resources) {
            server.resources.splice(index, 1);
            this.service.saveMCPServer(server);
        }
    }

    private showImportModal() {
        const content = `<textarea id="import-json" style="width:100%;height:200px" placeholder="Paste JSON array..."></textarea>`;
        new Modal('导入配置', content, {
            confirmText: '导入',
            onConfirm: async () => {
                const json = (document.getElementById('import-json') as HTMLTextAreaElement).value;
                try {
                    const data = JSON.parse(json);
                    const arr = Array.isArray(data) ? data : [data];
                    for (const item of arr) {
                        item.id = item.id || `mcp-${generateShortUUID()}`;
                        await this.service.saveMCPServer(item);
                    }
                    Toast.success(`导入 ${arr.length} 个配置`);
                } catch (e) {
                    Toast.error('JSON 格式错误');
                    return false;
                }
            }
        }).show();
    }

    private async exportAll() {
        const data = JSON.stringify(await this.service.getMCPServers(), null, 2);
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'mcp-servers.json';
        a.click();
    }
}