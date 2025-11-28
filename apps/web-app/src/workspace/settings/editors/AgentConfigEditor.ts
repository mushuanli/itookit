// @file: src/workspace/settings/editors/AgentConfigEditor.ts
import { 
    IEditor, 
    EditorOptions, 
    UnifiedSearchResult, 
    Heading, 
    EditorEvent, 
    EditorEventCallback 
} from '@itookit/common';
import { AgentFileContent } from '../types';
import { SettingsService } from '../services/SettingsService';

/**
 * Agent 配置编辑器
 * 提供用户友好的表单界面来编辑 .agent 文件
 */
export class AgentConfigEditor implements IEditor {
    private container!: HTMLElement;
    private content: AgentFileContent | null = null;
    private _isDirty = false;
    private listeners = new Map<string, Set<EditorEventCallback>>();
    private originalContent: string = '';

    constructor(
        _container: HTMLElement, 
        _options: EditorOptions,
        private service: SettingsService
    ) {}

    async init(container: HTMLElement, initialContent?: string) {
        this.container = container;
        this.container.classList.add('agent-config-editor');
        this.injectStyles();
        
        // [健壮性修复] 确保内容不为空，防止 JSON.parse 崩溃
        // 如果文件是空的（例如异常创建），回退到空对象 '{}'，setText 会处理后续逻辑
        this.originalContent = (initialContent && initialContent.trim().length > 0) 
            ? initialContent 
            : '{}';
            
        this.setText(this.originalContent);
        this.emit('ready');
    }

    private injectStyles() {
        if (document.getElementById('agent-editor-styles')) return;
        
        const style = document.createElement('style');
        style.id = 'agent-editor-styles';
        style.textContent = `
            .agent-config-editor {
                height: 100%;
                overflow-y: auto;
                background: var(--st-bg-primary, #fff);
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            }

            .agent-editor-container {
                max-width: 800px;
                margin: 0 auto;
                padding: 24px;
            }

            /* Header */
            .agent-header {
                display: flex;
                align-items: center;
                gap: 20px;
                padding: 24px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                border-radius: 16px;
                margin-bottom: 24px;
                color: white;
            }

            .agent-header__icon-picker {
                width: 80px;
                height: 80px;
                border-radius: 16px;
                background: rgba(255,255,255,0.2);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 40px;
                cursor: pointer;
                transition: all 0.2s;
                border: 3px dashed rgba(255,255,255,0.4);
            }

            .agent-header__icon-picker:hover {
                background: rgba(255,255,255,0.3);
                transform: scale(1.05);
            }

            .agent-header__info {
                flex: 1;
            }

            .agent-header__name-input {
                background: transparent;
                border: none;
                font-size: 1.75rem;
                font-weight: 700;
                color: white;
                width: 100%;
                outline: none;
                padding: 4px 0;
                border-bottom: 2px solid transparent;
            }

            .agent-header__name-input:focus {
                border-bottom-color: rgba(255,255,255,0.5);
            }

            .agent-header__name-input::placeholder {
                color: rgba(255,255,255,0.6);
            }

            .agent-header__desc-input {
                background: transparent;
                border: none;
                font-size: 0.95rem;
                color: rgba(255,255,255,0.9);
                width: 100%;
                outline: none;
                margin-top: 8px;
                resize: none;
            }

            .agent-header__desc-input::placeholder {
                color: rgba(255,255,255,0.5);
            }

            /* Section */
            .agent-section {
                background: var(--st-bg-primary, #fff);
                border: 1px solid var(--st-border-color, #e5e7eb);
                border-radius: 12px;
                margin-bottom: 20px;
                overflow: hidden;
            }

            .agent-section__header {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 16px 20px;
                background: var(--st-bg-secondary, #f9fafb);
                border-bottom: 1px solid var(--st-border-color, #e5e7eb);
                cursor: pointer;
                user-select: none;
            }

            .agent-section__header:hover {
                background: var(--st-bg-tertiary, #f3f4f6);
            }

            .agent-section__icon {
                font-size: 1.25rem;
            }

            .agent-section__title {
                flex: 1;
                font-weight: 600;
                font-size: 1rem;
                color: var(--st-text-primary, #111827);
            }

            .agent-section__toggle {
                color: var(--st-text-secondary, #6b7280);
                transition: transform 0.2s;
            }

            .agent-section.collapsed .agent-section__toggle {
                transform: rotate(-90deg);
            }

            .agent-section__body {
                padding: 20px;
            }

            .agent-section.collapsed .agent-section__body {
                display: none;
            }

            /* Form Row */
            .agent-form-row {
                margin-bottom: 20px;
            }

            .agent-form-row:last-child {
                margin-bottom: 0;
            }

            .agent-form-label {
                display: block;
                font-weight: 500;
                font-size: 0.875rem;
                color: var(--st-text-primary, #111827);
                margin-bottom: 8px;
            }

            .agent-form-label small {
                font-weight: 400;
                color: var(--st-text-secondary, #6b7280);
                margin-left: 8px;
            }

            .agent-form-input,
            .agent-form-select,
            .agent-form-textarea {
                width: 100%;
                padding: 10px 14px;
                border: 2px solid var(--st-border-color, #e5e7eb);
                border-radius: 8px;
                font-size: 0.9rem;
                transition: all 0.15s;
                background: var(--st-bg-primary, #fff);
                color: var(--st-text-primary, #111827);
            }

            .agent-form-input:focus,
            .agent-form-select:focus,
            .agent-form-textarea:focus {
                outline: none;
                border-color: #667eea;
                box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
            }

            .agent-form-textarea {
                min-height: 120px;
                resize: vertical;
                font-family: 'Monaco', 'Menlo', monospace;
                font-size: 0.85rem;
                line-height: 1.6;
            }

            .agent-form-help {
                font-size: 0.75rem;
                color: var(--st-text-secondary, #6b7280);
                margin-top: 6px;
            }

            /* Type Selector */
            .agent-type-selector {
                display: flex;
                gap: 12px;
            }

            .agent-type-option {
                flex: 1;
                padding: 16px;
                border: 2px solid var(--st-border-color, #e5e7eb);
                border-radius: 12px;
                cursor: pointer;
                transition: all 0.2s;
                text-align: center;
            }

            .agent-type-option:hover {
                border-color: #667eea;
                background: rgba(102, 126, 234, 0.05);
            }

            .agent-type-option.selected {
                border-color: #667eea;
                background: rgba(102, 126, 234, 0.1);
            }

            .agent-type-option__icon {
                font-size: 2rem;
                margin-bottom: 8px;
            }

            .agent-type-option__title {
                font-weight: 600;
                margin-bottom: 4px;
            }

            .agent-type-option__desc {
                font-size: 0.75rem;
                color: var(--st-text-secondary, #6b7280);
            }

            /* MCP Checklist */
            .agent-mcp-list {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }

            .agent-mcp-item {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 12px 16px;
                border: 1px solid var(--st-border-color, #e5e7eb);
                border-radius: 8px;
                cursor: pointer;
                transition: all 0.15s;
            }

            .agent-mcp-item:hover {
                background: var(--st-bg-secondary, #f9fafb);
                border-color: #667eea;
            }

            .agent-mcp-item input[type="checkbox"] {
                width: 18px;
                height: 18px;
                accent-color: #667eea;
            }

            .agent-mcp-item__info {
                flex: 1;
            }

            .agent-mcp-item__name {
                font-weight: 500;
                font-size: 0.9rem;
            }

            .agent-mcp-item__desc {
                font-size: 0.75rem;
                color: var(--st-text-secondary, #6b7280);
                margin-top: 2px;
            }

            .agent-mcp-item__status {
                font-size: 0.7rem;
                padding: 2px 8px;
                border-radius: 10px;
                background: var(--st-bg-tertiary, #f3f4f6);
                color: var(--st-text-secondary, #6b7280);
            }

            .agent-mcp-item__status.connected {
                background: #d1fae5;
                color: #065f46;
            }

            /* Empty State */
            .agent-empty-state {
                text-align: center;
                padding: 32px;
                color: var(--st-text-secondary, #6b7280);
            }

            .agent-empty-state__icon {
                font-size: 3rem;
                margin-bottom: 12px;
                opacity: 0.5;
            }

            /* Icon Picker Modal */
            .icon-picker-overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0,0,0,0.5);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
            }

            .icon-picker-modal {
                background: white;
                border-radius: 16px;
                padding: 24px;
                max-width: 400px;
                width: 90%;
            }

            .icon-picker-grid {
                display: grid;
                grid-template-columns: repeat(8, 1fr);
                gap: 8px;
                max-height: 300px;
                overflow-y: auto;
            }

            .icon-picker-item {
                width: 40px;
                height: 40px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 1.5rem;
                border-radius: 8px;
                cursor: pointer;
                transition: all 0.15s;
            }

            .icon-picker-item:hover {
                background: var(--st-bg-tertiary, #f3f4f6);
                transform: scale(1.1);
            }
        `;
        document.head.appendChild(style);
    }

    // --- Core IEditor Implementation ---

    getText(): string {
        if (!this.content) return '{}';
        this.syncModelFromUI();
        return JSON.stringify(this.content, null, 2);
    }

    setText(text: string) {
        try {
            const parsed = JSON.parse(text);
            this.content = {
                id: parsed.id || `agent-${Date.now()}`,
                name: parsed.name || 'New Agent',
                type: parsed.type || 'agent',
                description: parsed.description || '',
                icon: parsed.icon || '🤖',
                config: {
                    connectionId: parsed.config?.connectionId || '',
                    modelName: parsed.config?.modelName || '',
                    systemPrompt: parsed.config?.systemPrompt || 'You are a helpful assistant.',
                    mcpServers: parsed.config?.mcpServers || [],
                    maxHistoryLength: parsed.config?.maxHistoryLength ?? -1,
                    ...parsed.config
                },
                tags: parsed.tags || []
            };
            this.render();
        } catch (e) {
            this.renderError((e as Error).message);
            this.content = null;
        }
    }

    isDirty() { return this._isDirty; }
    setDirty(dirty: boolean) { this._isDirty = dirty; }

    // --- Rendering ---

    private render() {
        if (!this.content) return;
        const agent = this.content;
        const config = agent.config;
        
        const connections = this.service.getConnections();
        const selectedConn = connections.find(c => c.id === config.connectionId);
        const models = selectedConn?.availableModels || [];
        const allMCPServers = this.service.getMCPServers();

        this.container.innerHTML = `
            <div class="agent-editor-container">
                <!-- Header with Icon & Name -->
                <div class="agent-header">
                    <div class="agent-header__icon-picker" id="icon-picker" title="点击更换图标">
                        ${agent.icon || '🤖'}
                    </div>
                    <div class="agent-header__info">
                        <input type="text" 
                               class="agent-header__name-input" 
                               name="name" 
                               value="${this.escapeHtml(agent.name)}" 
                               placeholder="Agent 名称">
                        <textarea class="agent-header__desc-input" 
                                  name="description" 
                                  placeholder="描述这个 Agent 的用途..."
                                  rows="2">${this.escapeHtml(agent.description || '')}</textarea>
                    </div>
                </div>

                <!-- Type Selection -->
                <div class="agent-section">
                    <div class="agent-section__header">
                        <span class="agent-section__icon">🎯</span>
                        <span class="agent-section__title">Agent 类型</span>
                        <span class="agent-section__toggle">▼</span>
                    </div>
                    <div class="agent-section__body">
                        <div class="agent-type-selector">
                            <div class="agent-type-option ${agent.type === 'agent' ? 'selected' : ''}" data-type="agent">
                                <div class="agent-type-option__icon">🤖</div>
                                <div class="agent-type-option__title">Agent</div>
                                <div class="agent-type-option__desc">单一 LLM 驱动的智能体</div>
                            </div>
                            <div class="agent-type-option ${agent.type === 'orchestrator' ? 'selected' : ''}" data-type="orchestrator">
                                <div class="agent-type-option__icon">🕸️</div>
                                <div class="agent-type-option__title">Orchestrator</div>
                                <div class="agent-type-option__desc">协调多个 Agent 协作</div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- LLM Configuration (only for agent type) -->
                <div class="agent-section" id="llm-config-section" style="${agent.type === 'orchestrator' ? 'display:none' : ''}">
                    <div class="agent-section__header">
                        <span class="agent-section__icon">🧠</span>
                        <span class="agent-section__title">LLM 配置</span>
                        <span class="agent-section__toggle">▼</span>
                    </div>
                    <div class="agent-section__body">
                        <div class="agent-form-row">
                            <label class="agent-form-label">
                                连接 <small>选择已配置的 LLM 服务</small>
                            </label>
                            <select class="agent-form-select" name="connectionId">
                                <option value="">-- 选择连接 --</option>
                                ${connections.map(c => `
                                    <option value="${c.id}" ${config.connectionId === c.id ? 'selected' : ''}>
                                        ${this.escapeHtml(c.name)} (${c.provider})
                                    </option>
                                `).join('')}
                            </select>
                            <p class="agent-form-help">
                                ${connections.length === 0 ? '⚠️ 请先在设置中添加 LLM 连接' : '选择此 Agent 使用的 LLM 服务'}
                            </p>
                        </div>

                        <div class="agent-form-row">
                            <label class="agent-form-label">
                                模型 <small>选择具体的模型</small>
                            </label>
                            <select class="agent-form-select" name="modelName" id="model-select">
                                ${models.length > 0 
                                    ? models.map(m => `
                                        <option value="${m.id}" ${config.modelName === m.id ? 'selected' : ''}>
                                            ${m.name}
                                        </option>
                                    `).join('')
                                    : '<option value="">请先选择连接</option>'
                                }
                            </select>
                        </div>

                        <div class="agent-form-row">
                            <label class="agent-form-label">
                                System Prompt <small>定义 Agent 的行为和角色</small>
                            </label>
                            <textarea class="agent-form-textarea" 
                                      name="systemPrompt" 
                                      placeholder="You are a helpful assistant...">${this.escapeHtml(config.systemPrompt || '')}</textarea>
                            <p class="agent-form-help">
                                提示：好的 System Prompt 应该清晰定义 Agent 的角色、能力边界和输出格式
                            </p>
                        </div>

                        <div class="agent-form-row">
                            <label class="agent-form-label">
                                历史消息数量 <small>-1 表示不限制</small>
                            </label>
                            <input type="number" 
                                   class="agent-form-input" 
                                   name="maxHistoryLength" 
                                   value="${config.maxHistoryLength ?? -1}"
                                   min="-1"
                                   style="max-width: 150px;">
                        </div>
                    </div>
                </div>

                <!-- MCP Tools -->
                <div class="agent-section" id="mcp-section" style="${agent.type === 'orchestrator' ? 'display:none' : ''}">
                    <div class="agent-section__header">
                        <span class="agent-section__icon">🔧</span>
                        <span class="agent-section__title">工具能力 (MCP)</span>
                        <span class="agent-section__toggle">▼</span>
                    </div>
                    <div class="agent-section__body">
                        ${allMCPServers.length === 0 
                            ? `<div class="agent-empty-state">
                                    <div class="agent-empty-state__icon">🔌</div>
                                    <p>暂无可用的 MCP 服务器</p>
                                    <p style="font-size:0.8rem; margin-top:8px;">请在设置 → MCP Servers 中添加</p>
                               </div>`
                            : `<p class="agent-form-help" style="margin-bottom:12px;">
                                    选择此 Agent 可以调用的工具服务
                               </p>
                               <div class="agent-mcp-list">
                                    ${allMCPServers.map(server => `
                                        <label class="agent-mcp-item">
                                            <input type="checkbox" 
                                                   name="mcpServers" 
                                                   value="${server.id}" 
                                                   ${(config.mcpServers || []).includes(server.id) ? 'checked' : ''}>
                                            <div class="agent-mcp-item__info">
                                                <div class="agent-mcp-item__name">
                                                    ${server.icon || '🔌'} ${this.escapeHtml(server.name)}
                                                </div>
                                                <div class="agent-mcp-item__desc">
                                                    ${this.escapeHtml(server.description || '无描述')}
                                                </div>
                                            </div>
                                            <span class="agent-mcp-item__status ${server.status === 'connected' ? 'connected' : ''}">
                                                ${server.status === 'connected' ? '已连接' : '未连接'}
                                            </span>
                                        </label>
                                    `).join('')}
                               </div>`
                        }
                    </div>
                </div>

                <!-- Advanced Settings -->
                <div class="agent-section collapsed">
                    <div class="agent-section__header">
                        <span class="agent-section__icon">⚙️</span>
                        <span class="agent-section__title">高级设置</span>
                        <span class="agent-section__toggle">▼</span>
                    </div>
                    <div class="agent-section__body">
                        <div class="agent-form-row">
                            <label class="agent-form-label">Agent ID</label>
                            <input type="text" 
                                   class="agent-form-input" 
                                   name="id" 
                                   value="${this.escapeHtml(agent.id)}" 
                                   readonly 
                                   style="background: var(--st-bg-tertiary, #f3f4f6); cursor: not-allowed;">
                            <p class="agent-form-help">系统生成的唯一标识符，不可修改</p>
                        </div>
                    </div>
                </div>

                <!-- Hidden field for icon -->
                <input type="hidden" name="icon" value="${agent.icon || '🤖'}">
            </div>
        `;

        this.bindEvents();
    }

    private renderError(message: string) {
        this.container.innerHTML = `
            <div class="agent-editor-container">
                <div style="padding: 40px; text-align: center; color: #ef4444;">
                    <div style="font-size: 3rem; margin-bottom: 16px;">⚠️</div>
                    <h3 style="margin-bottom: 8px;">配置解析失败</h3>
                    <p style="color: #6b7280; font-size: 0.9rem;">${this.escapeHtml(message)}</p>
                    <pre style="margin-top: 16px; padding: 16px; background: #fef2f2; border-radius: 8px; text-align: left; overflow: auto; font-size: 0.8rem;">${this.escapeHtml(this.originalContent)}</pre>
                </div>
            </div>
        `;
    }

    private bindEvents() {
        // 全局变更监听
        const handleChange = () => {
            this._isDirty = true;
            this.emit('interactiveChange');
        };

        // Input/Select/Textarea 变更
        this.container.querySelectorAll('input, select, textarea').forEach(el => {
            el.addEventListener('input', handleChange);
            el.addEventListener('change', handleChange);
        });

        // Section 折叠/展开
        this.container.querySelectorAll('.agent-section__header').forEach(header => {
            header.addEventListener('click', () => {
                const section = header.closest('.agent-section');
                section?.classList.toggle('collapsed');
            });
        });

        // Type 选择
        this.container.querySelectorAll('.agent-type-option').forEach(option => {
            option.addEventListener('click', () => {
                const type = (option as HTMLElement).dataset.type;
                if (!type) return;

                // 更新 UI
                this.container.querySelectorAll('.agent-type-option').forEach(o => 
                    o.classList.remove('selected')
                );
                option.classList.add('selected');

                // 显示/隐藏相关配置区域
                const llmSection = this.container.querySelector('#llm-config-section') as HTMLElement;
                const mcpSection = this.container.querySelector('#mcp-section') as HTMLElement;
                
                if (type === 'orchestrator') {
                    llmSection?.style.setProperty('display', 'none');
                    mcpSection?.style.setProperty('display', 'none');
                } else {
                    llmSection?.style.setProperty('display', 'block');
                    mcpSection?.style.setProperty('display', 'block');
                }

                handleChange();
            });
        });

        // Connection 与 Model 联动
        const connSelect = this.container.querySelector('select[name="connectionId"]') as HTMLSelectElement;
        const modelSelect = this.container.querySelector('#model-select') as HTMLSelectElement;
        
        if (connSelect && modelSelect) {
            connSelect.addEventListener('change', () => {
                const connId = connSelect.value;
                const conn = this.service.getConnections().find(c => c.id === connId);
                const models = conn?.availableModels || [];
                
                modelSelect.innerHTML = models.length > 0
                    ? models.map(m => `<option value="${m.id}">${m.name}</option>`).join('')
                    : '<option value="">请先选择连接</option>';
                
                handleChange();
            });
        }

        // Icon Picker
        const iconPicker = this.container.querySelector('#icon-picker');
        if (iconPicker) {
            iconPicker.addEventListener('click', () => this.showIconPicker());
        }
    }

    private showIconPicker() {
        const icons = [
            '🤖', '🧠', '💡', '🎯', '🚀', '⚡', '🔥', '✨',
            '🎨', '📝', '📊', '📈', '🔍', '🔧', '⚙️', '🛠️',
            '💻', '🖥️', '📱', '🌐', '☁️', '🔒', '🔑', '📡',
            '🎭', '🎪', '🎬', '🎮', '🎲', '🃏', '🎵', '🎸',
            '📚', '📖', '✏️', '🖊️', '📌', '📎', '🗂️', '📁',
            '💬', '💭', '🗨️', '👤', '👥', '🤝', '👋', '✋',
            '🌟', '⭐', '🌙', '☀️', '🌈', '🍀', '🌸', '🌺',
            '🦾', '🦿', '🕸️', '🔮', '💎', '🏆', '🎖️', '🥇'
        ];

        const overlay = document.createElement('div');
        overlay.className = 'icon-picker-overlay';
        overlay.innerHTML = `
            <div class="icon-picker-modal">
                <h3 style="margin: 0 0 16px 0; font-size: 1.1rem;">选择图标</h3>
                <div class="icon-picker-grid">
                    ${icons.map(icon => `
                        <div class="icon-picker-item" data-icon="${icon}">${icon}</div>
                    `).join('')}
                </div>
                <div style="margin-top: 16px; text-align: right;">
                    <button class="icon-picker-cancel" style="padding: 8px 16px; border: none; background: #e5e7eb; border-radius: 6px; cursor: pointer;">取消</button>
                </div>
            </div>
        `;

        // 选择图标
        overlay.querySelectorAll('.icon-picker-item').forEach(item => {
            item.addEventListener('click', () => {
                const icon = (item as HTMLElement).dataset.icon;
                if (icon) {
                    // 更新 UI
                    const iconDisplay = this.container.querySelector('#icon-picker');
                    if (iconDisplay) iconDisplay.textContent = icon;
                    
                    // 更新隐藏字段
                    const iconInput = this.container.querySelector('input[name="icon"]') as HTMLInputElement;
                    if (iconInput) iconInput.value = icon;
                    
                    this._isDirty = true;
                    this.emit('interactiveChange');
                }
                overlay.remove();
            });
        });

        // 取消
        overlay.querySelector('.icon-picker-cancel')?.addEventListener('click', () => {
            overlay.remove();
        });

        // 点击背景关闭
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });

        document.body.appendChild(overlay);
    }

    private syncModelFromUI() {
        if (!this.content) return;

        const getVal = (name: string): string => {
            const el = this.container.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
            return el?.value || '';
        };

        const getCheckedValues = (name: string): string[] => {
            return Array.from(this.container.querySelectorAll(`input[name="${name}"]:checked`))
                .map((el: any) => el.value);
        };

        // 获取选中的类型
        const selectedType = this.container.querySelector('.agent-type-option.selected') as HTMLElement;
        const type = selectedType?.dataset.type as 'agent' | 'orchestrator' || 'agent';

        this.content.name = getVal('name');
        this.content.icon = getVal('icon');
        this.content.description = getVal('description');
        this.content.type = type;

        if (type === 'agent') {
            this.content.config = {
                connectionId: getVal('connectionId'),
                modelName: getVal('modelName'),
                systemPrompt: getVal('systemPrompt'),
                maxHistoryLength: parseInt(getVal('maxHistoryLength')) || -1,
                mcpServers: getCheckedValues('mcpServers'),
                autoPrompts: this.content.config?.autoPrompts || []
            };
        }
    }

    private escapeHtml(str: string): string {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // --- IEditor Interface Implementation ---

    async destroy() { 
        this.container.innerHTML = ''; 
        this.listeners.clear(); 
    }
    
    getMode(): 'edit' | 'render' { return 'edit'; }
    async switchToMode(_mode: 'edit' | 'render') {}
    setTitle(_title: string) {}
    setReadOnly(_readOnly: boolean) {}
    focus() { 
        const nameInput = this.container.querySelector('.agent-header__name-input') as HTMLInputElement;
        nameInput?.focus();
    }
    get commands() { return {}; }
    
    async getHeadings(): Promise<Heading[]> { return []; }
    async getSearchableText() { return JSON.stringify(this.content || {}); }
    async getSummary() { return this.content?.description || null; }
    
    async navigateTo() {}
    async search(): Promise<UnifiedSearchResult[]> { return []; }
    gotoMatch() {}
    clearSearch() {}

    // Events
    on(event: EditorEvent, cb: EditorEventCallback) { 
        if (!this.listeners.has(event)) this.listeners.set(event, new Set());
        this.listeners.get(event)!.add(cb);
        return () => this.listeners.get(event)?.delete(cb);
    }
    
    private emit(event: string, payload?: any) { 
        this.listeners.get(event)?.forEach(cb => cb(payload)); 
    }
}