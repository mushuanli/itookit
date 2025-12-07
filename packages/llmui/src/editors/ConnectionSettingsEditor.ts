// @file llm-ui/editors/ConnectionSettingsEditor.ts
import { Modal, Toast,BaseSettingsEditor, LLMConnection, generateShortUUID, LLM_PROVIDER_DEFAULTS } from '@itookit/common';
import { IAgentService } from '@itookit/llm-engine';
// [新增] 引入测试函数
import { testLLMConnection } from '@itookit/llmdriver';

export class ConnectionSettingsEditor extends BaseSettingsEditor<IAgentService> {
    private testingConnections = new Set<string>();

    async render() {
        const connections = await this.service.getConnections();

        this.container.innerHTML = `
            <div class="settings-page">
                <div class="settings-page__header">
                    <div>
                        <h2 class="settings-page__title">LLM 连接配置</h2>
                        <p class="settings-page__description">管理第三方 LLM 服务的连接凭据</p>
                    </div>
                    <button id="btn-add-connection" class="settings-btn settings-btn--primary">
                        <span class="settings-btn__icon">+</span> 添加连接
                    </button>
                </div>
                
                <div id="connections-list" class="settings-connection-grid">
                    ${connections.map(conn => this.renderConnectionCard(conn)).join('')}
                </div>
                
                ${connections.length === 0 ? `
                    <div class="settings-empty">
                        <div class="settings-empty__icon">🔌</div>
                        <h3 class="settings-empty__title">还没有配置连接</h3>
                        <p class="settings-empty__text">点击"添加连接"按钮来配置您的第一个 LLM 服务连接</p>
                    </div>
                ` : ''}
            </div>
        `;
        
        this.bindEvents();
    }

    private renderConnectionCard(conn: LLMConnection) {
        const isDefault = conn.id === 'default';
        const provider = LLM_PROVIDER_DEFAULTS[conn.provider];
        const modelList = provider?.models || [];
        const model = modelList.find(m => m.id === conn.model);
        const modelName = model ? model.name : (conn.model || '未设置');
        
        return `
            <div class="settings-connection-card ${isDefault ? 'settings-connection-card--default' : ''}" data-id="${conn.id}">
                <div class="settings-connection-card__header">
                    <h3 class="settings-connection-card__title">${conn.name}</h3>
                    ${isDefault ? '<span class="settings-badge settings-badge--success">默认</span>' : ''}
                </div>
                
                <div class="settings-connection-card__details">
                    <div class="settings-detail-item">
                        <span class="settings-detail-item__label">提供商</span>
                        <span class="settings-detail-item__value">${provider?.name || conn.provider}</span>
                    </div>
                    <div class="settings-detail-item">
                        <span class="settings-detail-item__label">模型</span>
                        <span class="settings-detail-item__value">${modelName}</span>
                    </div>
                    <div class="settings-detail-item">
                        <span class="settings-detail-item__label">API Key</span>
                        <span class="settings-detail-item__value masked">${conn.apiKey ? '••••••••' : '未设置'}</span>
                    </div>
                </div>
                
                <div class="settings-page__actions" style="margin-top:auto; width:100%">
                    <button class="settings-btn settings-btn--secondary settings-btn--sm settings-btn-edit" style="flex:1">✏️ 编辑</button>
                    <button class="settings-btn settings-btn--secondary settings-btn--sm settings-btn-test" style="flex:1">🔍 测试</button>
                    ${!isDefault ? '<button class="settings-btn settings-btn--danger settings-btn--sm settings-btn-delete" style="flex:1">🗑️ 删除</button>' : ''}
                </div>
            </div>
        `;
    }

    private bindEvents() {
        this.clearListeners();
        
        this.bindButton('#btn-add-connection', () => this.showEditModal(null));

        const list = this.container.querySelector('#connections-list');
        if (list) {
            this.addEventListener(list, 'click', async (e) => {
                const target = e.target as HTMLElement;
                const card = target.closest('.settings-connection-card') as HTMLElement;
                if (!card) return;

                const id = card.dataset.id!;
                const connection = (await this.service.getConnections()).find(c => c.id === id);
                if (!connection) return;

                if (target.closest('.settings-btn-edit')) {
                    this.showEditModal(connection);
                } else if (target.closest('.settings-btn-test')) {
                    await this.testConnection(card, connection);
                } else if (target.closest('.settings-btn-delete')) {
                    this.deleteConnection(id, connection.name);
                }
            });
        }
    }

    private showEditModal(connection: LLMConnection | null) {
        const isNew = !connection;
        const providers = Object.keys(LLM_PROVIDER_DEFAULTS);
        const initialProvider = connection?.provider || providers[0];
        const initialModels = LLM_PROVIDER_DEFAULTS[initialProvider]?.models || [];
        
        const modalContent = `
            <form id="connection-form" class="settings-form">
                <div class="settings-form__group">
                    <label class="settings-form__label">连接名称 *</label>
                    <input type="text" class="settings-form__input" name="name" value="${connection?.name || ''}" required placeholder="例如: 我的 OpenAI">
                </div>
                
                <div class="settings-form__group">
                    <label class="settings-form__label">提供商 *</label>
                    <select class="settings-form__select" id="conn-provider" name="provider" required>
                        ${providers.map(p => `
                            <option value="${p}" ${connection?.provider === p ? 'selected' : ''}>
                                ${LLM_PROVIDER_DEFAULTS[p].name}
                            </option>
                        `).join('')}
                    </select>
                </div>
                
                <div class="settings-form__group">
                    <label class="settings-form__label">默认模型 *</label>
                    <select class="settings-form__select" id="conn-model" name="model" required>
                        ${initialModels.length > 0
                            ? initialModels.map(m => `
                                <option value="${m.id}" ${connection?.model === m.id ? 'selected' : ''}>
                                    ${m.name}
                                </option>
                            `).join('')
                            : '<option value="">-- 请先选择提供商 --</option>'
                        }
                    </select>
                    <small class="settings-form__help">切换提供商后会自动更新模型列表</small>
                </div>
                
                <div class="settings-form__group">
                    <label class="settings-form__label">API Key *</label>
                    <input type="password" class="settings-form__input" name="apiKey" value="${connection?.apiKey || ''}" required placeholder="sk-...">
                </div>
                
                <div class="settings-form__group">
                    <label class="settings-form__label">Base URL（可选）</label>
                    <input type="text" class="settings-form__input" id="conn-baseurl" name="baseURL" value="${connection?.baseURL || ''}" placeholder="留空使用默认">
                </div>
            </form>
        `;

        new Modal(isNew ? '添加新连接' : '编辑连接', modalContent, {
            confirmText: '保存',
            onConfirm: async () => {
                const form = document.getElementById('connection-form') as HTMLFormElement;
                if (!form.checkValidity()) {
                    form.reportValidity();
                    return false;
                }
                
                const formData = new FormData(form);
                const data = Object.fromEntries(formData) as any;
                
                // ✅ 修复：保留原有的 availableModels，或从 provider 默认值获取
                const providerDef = LLM_PROVIDER_DEFAULTS[data.provider];
                const newConn: LLMConnection = {
                    id: connection?.id || `conn-${generateShortUUID()}`,
                    name: data.name,
                    provider: data.provider,
                    apiKey: data.apiKey,
                    model: data.model,
                    baseURL: data.baseURL || providerDef?.baseURL || '',
                    // ✅ 关键修复：确保 availableModels 不丢失
                    availableModels: connection?.availableModels 
                        || (providerDef ? [...providerDef.models] : []),
                    metadata: connection?.metadata
                };
                
                await this.service.saveConnection(newConn);
                Toast.success(isNew ? '连接已创建！' : '连接已更新！');
            }
        }).show();
        
        // Dynamic Provider Switch
        setTimeout(() => {
            const providerSelect = document.getElementById('conn-provider') as HTMLSelectElement;
            const modelSelect = document.getElementById('conn-model') as HTMLSelectElement;
            const baseUrlInput = document.getElementById('conn-baseurl') as HTMLInputElement;
            
            if (providerSelect) {
                providerSelect.addEventListener('change', (e) => {
                    const providerKey = (e.target as HTMLSelectElement).value;
                    const defaults = LLM_PROVIDER_DEFAULTS[providerKey];
                    const models = defaults?.models || [];
                    
                    modelSelect.innerHTML = models.length > 0
                        ? models.map(m => `<option value="${m.id}">${m.name}</option>`).join('')
                        : '<option value="">-- 该提供商无可用模型 --</option>';
                    
                    // 自动填充 BaseURL
                    const oldProvider = connection?.provider || providers[0];
                    const oldBaseUrl = LLM_PROVIDER_DEFAULTS[oldProvider]?.baseURL || '';
                    if (!baseUrlInput.value || baseUrlInput.value === oldBaseUrl) {
                        baseUrlInput.value = defaults?.baseURL || '';
                    }
                });
            }
        }, 100);
    }

    private async testConnection(card: HTMLElement, connection: LLMConnection) {
        if (this.testingConnections.has(connection.id)) return;
        
        // 检查 API Key 是否存在
        if (!connection.apiKey) {
            Toast.warning('请先配置 API Key');
            return;
        }
        
        this.testingConnections.add(connection.id);
        const testBtn = card.querySelector('.settings-btn-test') as HTMLButtonElement;
        const originalText = testBtn.innerHTML;
        testBtn.innerHTML = '⏳ 测试中...';
        testBtn.disabled = true;

        try {
            // [修复] 调用真实的测试函数
            // 注意：connection 对象结构需符合 testLLMConnection 的参数要求
            // testLLMConnection(config: { provider: string; apiKey: string; baseURL?: string; model?: string; })
            const result = await testLLMConnection({
                provider: connection.provider,
                apiKey: connection.apiKey,
                baseURL: connection.baseURL,
                model: connection.model
            });

            if (result.success) {
                Toast.success(result.message || '连接测试成功！');
                testBtn.innerHTML = '✅ 成功';
                testBtn.classList.remove('settings-btn--secondary');
                testBtn.classList.add('settings-btn--success'); // 假设有这个样式
            } else {
                Toast.error(`测试失败: ${result.message}`);
                testBtn.innerHTML = '❌ 失败';
                testBtn.classList.remove('settings-btn--secondary');
                testBtn.classList.add('settings-btn--danger');
            }
        } catch (error: any) {
            console.error(error);
            Toast.error(`测试出错: ${error.message}`);
            testBtn.innerHTML = '❌ 出错';
        } finally {
            setTimeout(() => {
                testBtn.innerHTML = originalText;
                testBtn.disabled = false;
                // 恢复样式
                testBtn.classList.remove('settings-btn--success', 'settings-btn--danger');
                testBtn.classList.add('settings-btn--secondary');
                this.testingConnections.delete(connection.id);
            }, 3000);
        }
    }

    private deleteConnection(id: string, name: string) {
        Modal.confirm('确认删除', `确定要删除连接"${name}"吗？此操作无法撤销。`, async () => {
            await this.service.deleteConnection(id);
            Toast.success('连接已删除');
        });
    }

    private bindButton(selector: string, handler: () => void) {
        const btn = this.container.querySelector(selector);
        if (btn) this.addEventListener(btn, 'click', handler);
    }
}
