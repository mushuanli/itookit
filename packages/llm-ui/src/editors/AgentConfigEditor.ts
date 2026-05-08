// @file: llm-ui/editors/AgentConfigEditor.ts

import {
    IEditor, EditorOptions, EditorEvent, EditorEventCallback,
    generateUUID,
    buildRenamedFilename,
    Heading,
    UnifiedSearchResult,
    CollapseExpandResult
} from '@itookit/common';
import type { AgentType, AgentDefinition, IAgentManagementService, ModelTier } from '@itookit/common';

/**
 * Agent 配置编辑器
 * 需要完整的 CRUD 能力，因此依赖 IAgentManagementService
 */
export class AgentConfigEditor implements IEditor {
    private container!: HTMLElement;
    private content: AgentDefinition | null = null;
    private _isDirty = false;
    private listeners = new Map<string, Set<EditorEventCallback>>();
    private originalContent: string = '';
    private currentTitle: string = '';

    constructor(
        _container: HTMLElement,
        private readonly options: EditorOptions,
        private service: IAgentManagementService
    ) { }

    async init(container: HTMLElement, initialContent?: string) {
        this.container = container;
        this.container.classList.add('agent-config-editor');
        this.originalContent = initialContent || '{}';
        this.currentTitle = (this.options.title as string) || '';
        this.setText(this.originalContent);
        this.emit('ready');
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

            // [核心修改] ID 生成逻辑
            // 如果 parsed.id 为空字符串 (来自模板) 或 undefined，则生成 UUID
            const agentId = (parsed.id && parsed.id.trim() !== '')
                ? parsed.id
                : generateUUID();

            // ✅ 修复：使用有效的 AgentType
            const validType = this.normalizeAgentType(parsed.type);

            this.content = {
                id: agentId,
                name: parsed.name || 'New Agent',
                type: validType,
                description: parsed.description || '',
                icon: parsed.icon || '🤖',
                config: {
                    connectionId: parsed.config?.connectionId || '',
                    modelTier: (parsed.config?.modelTier as ModelTier | undefined) ?? 'optimal',
                    // Preserve modelName for backward compat with existing data
                    modelName: parsed.config?.modelName || undefined,
                    systemPrompt: parsed.config?.systemPrompt || 'You are a helpful assistant.',
                    mcpServers: parsed.config?.mcpServers || [],
                    maxHistoryLength: parsed.config?.maxHistoryLength ?? -1,
                    temperature: parsed.config?.temperature
                },
                interface: parsed.interface || {
                    inputs: [],
                    outputs: []
                }
                // 注意：这里不再处理 tags
            };
            this.render();
        } catch (e) {
            this.renderError((e as Error).message);
            this.content = null;
        }
    }

    /**
     * ✅ 新增：规范化 AgentType
     * 将旧的 'orchestrator' 映射到 'composite'
     */
    private normalizeAgentType(type: string | undefined): AgentType {
        switch (type) {
            case 'agent':
                return 'agent';
            case 'composite':
            case 'orchestrator':  // 兼容旧数据
                return 'composite';
            case 'tool':
                return 'tool';
            case 'workflow':
                return 'workflow';
            default:
                return 'agent';
        }
    }

    isDirty() { return this._isDirty; }
    setDirty(dirty: boolean) { this._isDirty = dirty; }

    // --- Rendering ---

    async render() {
        if (!this.content) return;
        const agent = this.content;
        const config = agent.config;

        // Only show connections that are enabled AND have an apiKey configured, sorted alphabetically
        const connections = (await this.service.getConnections())
            .filter(c => c.enabled !== false && c.hasApiKey)
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

        // 确保有有效的连接选择
        let selectedConn = connections.find(c => c.id === config.connectionId);

        // 如果没有选中的连接，或者连接ID为空，且有可用连接，默认选中列表第一个（即排序后的最优项）
        if (!selectedConn && connections.length > 0) {
            selectedConn = connections[0];
            if (this.content && this.content.config) {
                this.content.config.connectionId = selectedConn.id;
            }
        }

        const currentTier = config.modelTier ?? 'optimal';
        const allMCPServers = await this.service.getMCPServers();

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
                            <div class="agent-type-option ${agent.type === 'composite' ? 'selected' : ''}" data-type="composite">
                                <div class="agent-type-option__icon">🕸️</div>
                                <div class="agent-type-option__title">Composite</div>
                                <div class="agent-type-option__desc">协调多个 Agent 协作</div>
                            </div>
                            <div class="agent-type-option ${agent.type === 'workflow' ? 'selected' : ''}" data-type="workflow">
                                <div class="agent-type-option__icon">📋</div>
                                <div class="agent-type-option__title">Workflow</div>
                                <div class="agent-type-option__desc">预定义的工作流程</div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- LLM Configuration -->
                <div class="agent-section" id="llm-config-section" style="${agent.type !== 'agent' ? 'display:none' : ''}">
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
                            <select class="agent-form-select" name="connectionId" id="connection-select">
                                <option value="">-- 选择连接 --</option>
                                ${connections.map(c => {
            const hasKey = c.hasApiKey;
            const isDefault = c.id === 'default';
            // User Friendly Display
            let displayName = this.escapeHtml(c.name);
            if (isDefault) displayName = `⭐ ${displayName}`;
            if (!hasKey && !isDefault) displayName = `${displayName} (需配置)`;

            return `
                                    <option value="${c.id}" ${(selectedConn?.id === c.id) ? 'selected' : ''}>
                                        ${displayName} - ${c.provider}
                                    </option>
                                `}).join('')}
                            </select>
                            <p class="agent-form-help">
                                ${connections.length === 0 ? '⚠️ 请先在设置中添加 LLM 连接' : '选择此 Agent 使用的 LLM 服务'}
                            </p>
                        </div>

                        <div class="agent-form-row">
                            <label class="agent-form-label">
                                模型层级 <small>cost vs quality 偏好</small>
                            </label>
                            <div class="agent-tier-selector" id="tier-selector">
                                ${(['optimal', 'standard', 'fast'] as ModelTier[]).map(t => {
                const meta: Record<ModelTier, { label: string; desc: string; icon: string }> = {
                    optimal:  { label: '最优', desc: '复杂推理',   icon: '💎' },
                    standard: { label: '标准', desc: '日常工作',   icon: '⚖️' },
                    fast:     { label: '快速', desc: '简单任务',   icon: '⚡' },
                };
                const m = meta[t];
                return `
                                    <button type="button" class="agent-tier-btn ${currentTier === t ? 'selected' : ''}" data-tier="${t}" title="${m.desc}">
                                        <span class="agent-tier-btn__icon">${m.icon}</span>
                                        <span class="agent-tier-btn__label">${m.label}</span>
                                        <span class="agent-tier-btn__desc">${m.desc}</span>
                                    </button>`;
            }).join('')}
                            </div>
                            <input type="hidden" name="modelTier" id="model-tier-input" value="${currentTier}">
                            <p class="agent-form-help">连接需在 Settings → Connections 中配置对应 tier 模型</p>
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

                        <div class="agent-form-row">
                            <label class="agent-form-label">
                                温度 (0-2) <small>控制输出随机性</small>
                            </label>
                            <input type="number"
                                   class="agent-form-input"
                                   name="temperature"
                                   value="${config.temperature ?? ''}"
                                   min="0" max="2" step="0.1"
                                   placeholder="未设置（使用 Provider 默认）"
                                   style="max-width: 120px;">
                            <p class="agent-form-help">
                                值越高越随机。留空则使用 Provider 默认温度。
                            </p>
                        </div>
                    </div>
                </div>

                <!-- MCP Tools -->
                <div class="agent-section" id="mcp-section" style="${agent.type !== 'agent' ? 'display:none' : ''}">
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

        // 名称输入框 → 同步重命名 VFS 文件（复用 engine.rename + node:renamed 事件链）
        const nameInput = this.container.querySelector('.agent-header__name-input') as HTMLInputElement;
        const engine = this.options.sessionEngine;
        const nodeId = this.options.nodeId;
        if (nameInput && engine && nodeId) {
            const ext = (this.options.language as string) || '';
            const doRename = async () => {
                const newName = nameInput.value.trim();
                if (!newName || newName === this.currentTitle) return;
                const { filename } = buildRenamedFilename(newName, this.currentTitle + ext);
                try {
                    await engine.driver.rename(nodeId, filename);
                    this.currentTitle = newName;
                } catch {
                    nameInput.value = this.currentTitle;
                }
            };
            nameInput.addEventListener('blur', doRename);
            nameInput.addEventListener('keydown', (e: KeyboardEvent) => {
                if (e.key === 'Enter') { e.preventDefault(); nameInput.blur(); }
                if (e.key === 'Escape') { nameInput.value = this.currentTitle; nameInput.blur(); }
            });
        }

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
                const typeStr = (option as HTMLElement).dataset.type;
                if (!typeStr) return;

                // 更新 UI
                this.container.querySelectorAll('.agent-type-option').forEach(o =>
                    o.classList.remove('selected')
                );
                option.classList.add('selected');

                // 显示/隐藏相关配置区域
                const llmSection = this.container.querySelector('#llm-config-section') as HTMLElement;
                const mcpSection = this.container.querySelector('#mcp-section') as HTMLElement;

                // ✅ 修复：composite 和 workflow 类型隐藏 LLM 配置
                if (typeStr === 'composite' || typeStr === 'workflow') {
                    llmSection?.style.setProperty('display', 'none');
                    mcpSection?.style.setProperty('display', 'none');
                } else {
                    llmSection?.style.setProperty('display', 'block');
                    mcpSection?.style.setProperty('display', 'block');
                }

                // ✅ 更新内部状态
                const type = this.normalizeAgentType(typeStr);
                if (this.content) {
                    this.content.type = type;
                }

                handleChange();
            });
        });

        // Connection 变更（只更新 connectionId，tier 独立管理）
        const connSelect = this.container.querySelector('#connection-select') as HTMLSelectElement;
        if (connSelect) {
            connSelect.addEventListener('change', () => {
                if (this.content?.config) this.content.config.connectionId = connSelect.value;
                handleChange();
            });
        }

        // Tier 选择器
        const tierSelector = this.container.querySelector('#tier-selector');
        const tierInput = this.container.querySelector('#model-tier-input') as HTMLInputElement;
        if (tierSelector && tierInput) {
            tierSelector.addEventListener('click', (e) => {
                const btn = (e.target as HTMLElement).closest('.agent-tier-btn') as HTMLElement | null;
                if (!btn) return;
                const tier = btn.dataset.tier as ModelTier;
                if (!tier) return;
                tierSelector.querySelectorAll('.agent-tier-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
                tierInput.value = tier;
                if (this.content?.config) this.content.config.modelTier = tier;
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

        overlay.querySelector('.icon-picker-cancel')?.addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
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
        // ✅ 修复：使用 normalizeAgentType 确保类型有效
        const type = this.normalizeAgentType(selectedType?.dataset.type);

        this.content.name = getVal('name');
        this.content.icon = getVal('icon');
        this.content.description = getVal('description');
        this.content.type = type;

        if (type === 'agent') {
            const tempVal = parseFloat(getVal('temperature'));
            this.content.config = {
                connectionId: getVal('connectionId'),
                modelTier: (getVal('modelTier') as ModelTier) || 'optimal',
                systemPrompt: getVal('systemPrompt'),
                maxHistoryLength: parseInt(getVal('maxHistoryLength')) || -1,
                mcpServers: getCheckedValues('mcpServers'),
                temperature: !isNaN(tempVal) ? tempVal : undefined,
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
    async switchToMode(_mode: 'edit' | 'render') { }
    setTitle(_title: string) { }
    setReadOnly(_readOnly: boolean) { }
    focus() {
        const nameInput = this.container.querySelector('.agent-header__name-input') as HTMLInputElement;
        nameInput?.focus();
    }
    get commands() { return {}; }

    async getHeadings(): Promise<Heading[]> { return []; }
    async getSearchableText() { return JSON.stringify(this.content || {}); }
    async getSummary() { return this.content?.description || null; }

    async navigateTo() { }
    async search(): Promise<UnifiedSearchResult[]> { return []; }
    gotoMatch() { }
    clearSearch() { }

    async collapseBlocks(): Promise<CollapseExpandResult> {
        return { affectedCount: 0, allCollapsed: true };
    }

    async expandBlocks(): Promise<CollapseExpandResult> {
        return { affectedCount: 0, allCollapsed: false };
    }

    async toggleBlocks(): Promise<CollapseExpandResult> {
        return this.collapseBlocks();
    }

    async pruneAssets(): Promise<number | null> {
        return null;
    }

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
