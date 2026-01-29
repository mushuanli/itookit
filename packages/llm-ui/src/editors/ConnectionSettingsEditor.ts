// @file: llm-ui/editors/ConnectionSettingsEditor.ts

import { Modal, Toast, BaseSettingsEditor, generateShortUUID } from '@itookit/common';
import { testLLMConnection, LLMConnection, LLM_PROVIDER_DEFAULTS, LLMModel } from '@itookit/llm-driver';
import { IAgentService } from '@itookit/llm-engine';

export class ConnectionSettingsEditor extends BaseSettingsEditor<IAgentService> {
    private testingConnections = new Set<string>();
    
    // 编辑弹窗中的临时状态
    private currentEditModels: LLMModel[] = [];

    async render() {
        let connections = await this.service.getConnections();

        // ✅ [新增] 排序逻辑
        // 1. Default first
        // 2. Has API Key second
        // 3. No API Key last
        // 4. Name alphabetical within groups
        connections.sort((a, b) => {
            // Rule 1: Default always on top
            if (a.id === 'default') return -1;
            if (b.id === 'default') return 1;

            // Rule 2: Has API Key ?
            const aHasKey = !!(a.apiKey && a.apiKey.trim().length > 0);
            const bHasKey = !!(b.apiKey && b.apiKey.trim().length > 0);

            if (aHasKey && !bHasKey) return -1;
            if (!aHasKey && bHasKey) return 1;

            // Rule 3: Alphabetical by name (Fallback)
            return (a.name || '').localeCompare(b.name || '');
        });

        this.container.innerHTML = `
            <div class="settings-page">
                <div class="settings-page__header">
                    <div>
                        <h2 class="settings-page__title">LLM 连接配置</h2>
                        <p class="settings-page__description">管理第三方 LLM 服务的连接凭据与模型列表</p>
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
        const hasKey = !!(conn.apiKey && conn.apiKey.trim().length > 0);
        
        const provider = LLM_PROVIDER_DEFAULTS[conn.provider];
        // 优先使用连接内保存的模型列表，如果没有则回退到默认
        const modelList = (conn.availableModels && conn.availableModels.length > 0) 
            ? conn.availableModels 
            : (provider?.models || []);
            
        const modelObj = modelList.find(m => m.id === conn.model);
        const modelName = modelObj ? modelObj.name : (conn.model || '未设置');
        
        // ✅ [新增] 状态类名，用于 CSS 样式区分 (例如让未配置的稍微变灰)
        const statusClass = !hasKey ? 'settings-connection-card--incomplete' : '';

        // ✅ [新增] 状态标签
        let badgeHtml = '';
        if (isDefault) {
            badgeHtml = '<span class="settings-badge settings-badge--success">默认</span>';
        } else if (!hasKey) {
            badgeHtml = '<span class="settings-badge settings-badge--warning">需配置</span>';
        }

        // ✅ [新增] 按钮文案优化
        const editBtnText = hasKey ? '✏️ 编辑' : '⚙️ 去配置';
        const editBtnClass = hasKey ? 'settings-btn--secondary' : 'settings-btn--primary';

        return `
            <div class="settings-connection-card ${isDefault ? 'settings-connection-card--default' : ''} ${statusClass}" data-id="${conn.id}">
                <div class="settings-connection-card__header">
                    <h3 class="settings-connection-card__title">${conn.name}</h3>
                    ${badgeHtml}
                </div>
                
                <div class="settings-connection-card__details">
                    <div class="settings-detail-item">
                        <span class="settings-detail-item__label">提供商</span>
                        <span class="settings-detail-item__value">${provider?.name || conn.provider}</span>
                    </div>
                    <div class="settings-detail-item">
                        <span class="settings-detail-item__label">当前模型</span>
                        <span class="settings-detail-item__value">${modelName}</span>
                    </div>
                    <div class="settings-detail-item">
                        <span class="settings-detail-item__label">可用模型数</span>
                        <span class="settings-detail-item__value">${modelList.length} 个</span>
                    </div>
                    <div class="settings-detail-item">
                        <span class="settings-detail-item__label">API Key</span>
                        <span class="settings-detail-item__value masked">
                            ${hasKey ? '••••••••' : '<span style="color:var(--st-text-disabled)">未设置</span>'}
                        </span>
                    </div>
                </div>
                
                <div class="settings-page__actions" style="margin-top:auto; width:100%">
                    <button class="settings-btn ${editBtnClass} settings-btn--sm settings-btn-edit" style="flex:1">${editBtnText}</button>
                    <button class="settings-btn settings-btn--secondary settings-btn--sm settings-btn-test" style="flex:1" ${!hasKey ? 'disabled' : ''}>🔍 测试</button>
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

    // ✅ [修改] 渲染模型管理列表
    private renderModelListHTML(): string {
        if (this.currentEditModels.length === 0) {
            return '<div class="settings-empty-small">暂无模型，请添加</div>';
        }

        return this.currentEditModels.map((m, index) => `
            <div class="settings-model-item">
                <div class="settings-model-item__drag">::</div>
                <div class="settings-model-item__content">
                    <input type="text" class="settings-input-sm model-id-input" data-idx="${index}" value="${m.id}" placeholder="Model ID" title="Model ID (API用)">
                    <input type="text" class="settings-input-sm model-name-input" data-idx="${index}" value="${m.name}" placeholder="显示名称" title="显示名称">
                </div>
                <div class="settings-model-item__actions">
                    <button type="button" class="btn-icon btn-up" data-idx="${index}" ${index === 0 ? 'disabled' : ''}>⬆️</button>
                    <button type="button" class="btn-icon btn-down" data-idx="${index}" ${index === this.currentEditModels.length - 1 ? 'disabled' : ''}>⬇️</button>
                    <button type="button" class="btn-icon btn-del text-danger" data-idx="${index}">✖️</button>
                </div>
            </div>
        `).join('');
    }

    private showEditModal(connection: LLMConnection | null) {
        const isNew = !connection;
        const providers = Object.keys(LLM_PROVIDER_DEFAULTS);
        const initialProvider = connection?.provider || providers[0];
        
        // ✅ [新增] 初始化模型列表状态
        // 如果是新连接，用默认配置；如果是旧连接，优先用保存的，否则用默认配置
        if (connection && connection.availableModels) {
            this.currentEditModels = JSON.parse(JSON.stringify(connection.availableModels));
        } else {
            this.currentEditModels = JSON.parse(JSON.stringify(LLM_PROVIDER_DEFAULTS[initialProvider]?.models || []));
        }
        
        const modalContent = `
            <form id="connection-form" class="settings-form settings-form--wide">
                <div class="settings-row">
                    <!-- 左侧：基础信息 -->
                    <div class="settings-col">
                        <h4 class="settings-section-title">基础设置</h4>
                        <div class="settings-form__group">
                            <label class="settings-form__label">连接名称 *</label>
                            <input type="text" class="settings-form__input" name="name" value="${connection?.name || ''}" required placeholder="例如: 我的 OpenAI">
                        </div>
                        
                        <div class="settings-form__group">
                            <label class="settings-form__label">提供商 *</label>
                            <div style="display:flex; gap:8px">
                                <select class="settings-form__select" id="conn-provider" name="provider" required style="flex:1">
                                    ${providers.map(p => `
                                        <option value="${p}" ${initialProvider === p ? 'selected' : ''}>
                                            ${LLM_PROVIDER_DEFAULTS[p].name}
                                        </option>
                                    `).join('')}
                                </select>
                                <button type="button" id="btn-reset-defaults" class="settings-btn settings-btn--sm" title="重置 BaseURL 和模型列表为默认值">
                                    🔄 重置
                                </button>
                            </div>
                        </div>
                        
                        <div class="settings-form__group">
                            <label class="settings-form__label">API Key *</label>
                            <input type="password" class="settings-form__input" name="apiKey" value="${connection?.apiKey || ''}" required placeholder="sk-...">
                        </div>
                        
                        <div class="settings-form__group">
                            <label class="settings-form__label">Base URL</label>
                            <input type="text" class="settings-form__input" id="conn-baseurl" name="baseURL" value="${connection?.baseURL || ''}" placeholder="默认地址...">
                            <small class="settings-form__help">通常留空即可，除非使用代理或自定义端点。</small>
                        </div>

                         <div class="settings-form__group">
                            <label class="settings-form__label">默认选中模型</label>
                            <select class="settings-form__select" id="conn-model" name="model" required>
                                <!-- JS populate -->
                            </select>
                        </div>
                    </div>

                    <!-- 右侧：模型管理 -->
                    <div class="settings-col settings-col--border">
                        <h4 class="settings-section-title" style="display:flex; justify-content:space-between; align-items:center">
                            模型列表
                            <button type="button" id="btn-add-model" class="settings-btn settings-btn--xs settings-btn--primary">+ 新增</button>
                        </h4>
                        <div class="settings-model-list-container" id="model-list-container">
                            ${this.renderModelListHTML()}
                        </div>
                        <small class="settings-form__help">拖拽或点击箭头排序，API 请求将使用对应的 Model ID。</small>
                    </div>
                </div>
            </form>
        `;

        new Modal(isNew ? '添加连接' : '配置连接', modalContent, {
            width: '800px', // 变宽以容纳左右两栏
            confirmText: '保存',
            onConfirm: async () => {
                const form = document.getElementById('connection-form') as HTMLFormElement;
                if (!form.checkValidity()) {
                    form.reportValidity();
                    return false;
                }
                
                // ✅ [新增] 在保存前，先同步 Input 中的值到 currentEditModels
                // 因为用户可能修改了 input 但没触发 change 事件就点了保存
                this.syncInputsToModelData();
                
                if (this.currentEditModels.length === 0) {
                    Toast.warning('请至少保留一个可用模型');
                    return false;
                }

                const formData = new FormData(form);
                const data = Object.fromEntries(formData) as any;
                
                // 保留原有的 availableModels，或从 provider 默认值获取
                const providerDef = LLM_PROVIDER_DEFAULTS[data.provider];
                const newConn: LLMConnection = {
                    id: connection?.id || `conn-${generateShortUUID()}`,
                    name: data.name,
                    provider: data.provider,
                    apiKey: data.apiKey,
                    model: data.model,
                    baseURL: data.baseURL || providerDef?.baseURL || '',
                    // 确保 availableModels 不丢失
                    availableModels: [...this.currentEditModels], 
                    metadata: connection?.metadata
                };
                
                await this.service.saveConnection(newConn);
                Toast.success('连接配置已保存');
                this.render();
            }
        }).show();
        
        // Dynamic Provider Switch
        setTimeout(() => {
            this.bindModalEvents(connection);
        }, 100);
    }

    // ✅ [新增] 弹窗内部事件绑定逻辑
    private bindModalEvents(originalConn: LLMConnection | null) {
        const providerSelect = document.getElementById('conn-provider') as HTMLSelectElement;
        const modelSelect = document.getElementById('conn-model') as HTMLSelectElement;
        const baseUrlInput = document.getElementById('conn-baseurl') as HTMLInputElement;
        const resetBtn = document.getElementById('btn-reset-defaults') as HTMLButtonElement;
        const addModelBtn = document.getElementById('btn-add-model') as HTMLButtonElement;
        const listContainer = document.getElementById('model-list-container') as HTMLElement;

        const refreshModelSelect = () => {
            // 记录当前选中的值，刷新后尝试恢复
            const currentVal = modelSelect.value || originalConn?.model;
            
            modelSelect.innerHTML = this.currentEditModels.length > 0
                ? this.currentEditModels.map(m => `
                    <option value="${m.id}" ${currentVal === m.id ? 'selected' : ''}>
                        ${m.name} (${m.id})
                    </option>
                `).join('')
                : '<option value="">-- 请先添加模型 --</option>';
            
            // 如果原来的值还在列表中，保持选中；否则选中第一个
            if (this.currentEditModels.some(m => m.id === currentVal)) {
                modelSelect.value = currentVal!;
            } else if (this.currentEditModels.length > 0) {
                modelSelect.value = this.currentEditModels[0].id;
            }
        };

        const renderList = () => {
            listContainer.innerHTML = this.renderModelListHTML();
            refreshModelSelect();
        };

        // 1. Provider 切换
        if (providerSelect) {
            providerSelect.addEventListener('change', (e) => {
                const pKey = (e.target as HTMLSelectElement).value;
                const defs = LLM_PROVIDER_DEFAULTS[pKey];
                
                // 切换 Provider 时，询问是否加载该 Provider 的默认模型
                if (confirm('切换提供商将重置模型列表和 BaseURL 为默认值，是否继续？')) {
                    this.currentEditModels = JSON.parse(JSON.stringify(defs?.models || []));
                    baseUrlInput.value = defs?.baseURL || '';
                    renderList();
                } else {
                    // 用户取消，恢复 select 选项（略复杂，暂略，简单实现为不恢复）
                }
            });
        }

        // 2. 重置按钮 (Requirement 1)
        if (resetBtn) {
            resetBtn.addEventListener('click', (e) => {
                e.preventDefault(); // 防止提交表单
                if (!confirm('确定要重置 BaseURL 和模型列表到初始默认状态吗？自定义的模型将被清除。')) return;

                const pKey = providerSelect.value;
                const defs = LLM_PROVIDER_DEFAULTS[pKey];
                
                // 重置数据
                this.currentEditModels = JSON.parse(JSON.stringify(defs?.models || []));
                baseUrlInput.value = defs?.baseURL || '';
                
                renderList();
                Toast.success('已恢复默认配置');
            });
        }

        // 3. 模型列表操作 (Requirement 2)
        if (addModelBtn) {
            addModelBtn.addEventListener('click', () => {
                this.syncInputsToModelData(); // 先保存当前输入
                this.currentEditModels.push({ id: 'new-model', name: 'New Model', icon: '🤖' });
                renderList();
                // 滚动到底部
                listContainer.scrollTop = listContainer.scrollHeight;
            });
        }

        if (listContainer) {
            listContainer.addEventListener('click', (e) => {
                const target = e.target as HTMLElement;
                const btn = target.closest('button');
                if (!btn) return;

                const idx = parseInt(btn.dataset.idx!);
                if (isNaN(idx)) return;

                this.syncInputsToModelData(); // 操作前同步数据

                if (btn.classList.contains('btn-del')) {
                    this.currentEditModels.splice(idx, 1);
                } else if (btn.classList.contains('btn-up')) {
                    if (idx > 0) {
                        [this.currentEditModels[idx], this.currentEditModels[idx - 1]] = 
                        [this.currentEditModels[idx - 1], this.currentEditModels[idx]];
                    }
                } else if (btn.classList.contains('btn-down')) {
                    if (idx < this.currentEditModels.length - 1) {
                        [this.currentEditModels[idx], this.currentEditModels[idx + 1]] = 
                        [this.currentEditModels[idx + 1], this.currentEditModels[idx]];
                    }
                }
                renderList();
            });
            
            // 监听输入框变化，实时更新 select
            listContainer.addEventListener('input', (e) => {
                const target = e.target as HTMLInputElement;
                if (target.classList.contains('model-name-input') || target.classList.contains('model-id-input')) {
                     // 防抖或者是失焦更新太慢，这里简单做：
                     // 仅仅当修改 Name 时更新 Select 的文本显示比较复杂
                     // 我们选择在 blur 或 save 时统一同步，但为了体验，可以在这里不做重绘，
                     // 仅在 syncInputsToModelData 里处理
                }
            });
        }

        // 初始化
        refreshModelSelect();
    }

    // 辅助：将 DOM input 的值同步回内存数组
    private syncInputsToModelData() {
        const container = document.getElementById('model-list-container');
        if (!container) return;
        
        const rows = container.querySelectorAll('.settings-model-item');
        rows.forEach((row, index) => {
            if (index >= this.currentEditModels.length) return;
            
            const idInput = row.querySelector('.model-id-input') as HTMLInputElement;
            const nameInput = row.querySelector('.model-name-input') as HTMLInputElement;
            
            if (idInput) this.currentEditModels[index].id = idInput.value;
            if (nameInput) this.currentEditModels[index].name = nameInput.value;
        });
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
                testBtn.classList.add('settings-btn--success');
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
            this.render(); // 重新渲染列表
        });
    }

    private bindButton(selector: string, handler: () => void) {
        const btn = this.container.querySelector(selector);
        if (btn) this.addEventListener(btn, 'click', handler);
    }
}
