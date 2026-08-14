// @file: llm-ui/editors/AgentConfigEditor.ts

import {
    generateUUID,
    buildRenamedFilename,
    Heading
} from '@itookit/common';
import { IEditor, EditorOptions, EditorEvent, EditorEventMap, EditorEventCallback, UnifiedSearchResult, CollapseExpandResult } from '@itookit/ui-common';
import type { AgentType, AgentDefinition, IAgentManagementService, ModelTier, PromptPreset } from '@itookit/common';
import { EventBus } from '@itookit/stdio';
import { renderModelCapabilityBadges } from '../utils/modelBadges';

/**
 * Agent 配置编辑器
 * 需要完整的 CRUD 能力，因此依赖 IAgentManagementService
 */
export class AgentConfigEditor implements IEditor {
    private container!: HTMLElement;
    private content: AgentDefinition | null = null;
    private _isDirty = false;
    private editorEvents = new EventBus<EditorEventMap>();
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
        this.emit('ready', undefined);
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

            // 修复：使用有效的 AgentType
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
                },
                defaultPrompts: this.normalizePrompts(parsed.defaultPrompts)
                // 注意：这里不再处理 tags
            };
            this.render();
        } catch (e) {
            this.renderError((e as Error).message);
            this.content = null;
        }
    }

    /**
     * 规范化 defaultPrompts
     * 过滤非法项，保证每项为 { name, prompt } 字符串对。
     */
    private normalizePrompts(raw: unknown): PromptPreset[] {
        if (!Array.isArray(raw)) return [];
        return raw
            .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
            .map(p => ({
                name: typeof p.name === 'string' ? p.name : '',
                prompt: typeof p.prompt === 'string' ? p.prompt : '',
            }));
    }

    /**
     * 新增：规范化 AgentType
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

        // Fetch all connections, then split into valid (enabled + hasApiKey) and invalid
        const allConns = await this.service.getConnections();
        const connections = allConns
            .filter(c => c.enabled !== false && c.hasApiKey)
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        // Connections excluded because their Provider has no API key
        const noKeyConns = allConns.filter(c => c.enabled !== false && !c.hasApiKey);

        // Detect if the saved connectionId is now invalid (provider lost its key)
        const savedConnId = config.connectionId;
        const savedConnInvalid = !!(savedConnId && !connections.find(c => c.id === savedConnId));
        const savedConnMeta = savedConnInvalid ? allConns.find(c => c.id === savedConnId) : null;

        // 确保有有效的连接选择
        let selectedConn = connections.find(c => c.id === config.connectionId);

        // 如果没有选中的连接，或者连接ID为空，且有可用连接，默认选中列表第一个（即排序后的最优项）
        if (!selectedConn && connections.length > 0) {
            selectedConn = connections[0];
            if (this.content && this.content.config) {
                this.content.config.connectionId = selectedConn.id;
            }
        }

        // Group connections by provider for optgroup display
        const providers = this.service.getProviders();
        const providerMap = new Map(providers.map(p => [p.id, p]));
        const grouped = providers
            .map(p => ({
                provider: p,
                conns: connections.filter(c => c.providerId === p.id),
            }))
            .filter(g => g.conns.length > 0);
        const ungrouped = connections.filter(c => !providerMap.has(c.providerId));
        const connectionOptionsHtml = [
            ...grouped.map(g => `
                <optgroup label="${g.provider.icon ?? ''} ${this.escapeHtml(g.provider.name)}">
                    ${g.conns.map(c => `
                        <option value="${c.id}" ${selectedConn?.id === c.id ? 'selected' : ''}>
                            ${c.id === 'default' ? '⭐ ' : ''}${this.escapeHtml(c.name)}
                        </option>
                    `).join('')}
                </optgroup>
            `),
            ungrouped.length > 0 ? `
                <optgroup label="其他">
                    ${ungrouped.map(c => `
                        <option value="${c.id}" ${selectedConn?.id === c.id ? 'selected' : ''}>
                            ${this.escapeHtml(c.name)}
                        </option>
                    `).join('')}
                </optgroup>
            ` : '',
        ].join('');

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
                            ${savedConnInvalid ? `
                                <div class="agent-conn-invalid-banner">
                                    ⚠️ 连接「${this.escapeHtml(savedConnMeta?.name ?? savedConnId)}」不可用 — Provider 未配置 API Key。
                                    已自动切换至首个可用连接。
                                    <button class="agent-goto-btn" data-action="goto-providers"
                                            data-provider-id="${this.escapeHtml(savedConnMeta?.providerId ?? '')}">
                                        → 配置 Provider API Key
                                    </button>
                                </div>
                            ` : ''}
                            <div style="display:flex;align-items:center;gap:6px">
                                <select class="agent-form-select" name="connectionId" id="connection-select"
                                        style="flex:1" ${connections.length === 0 ? 'disabled' : ''}>
                                    <option value="">-- 选择连接 --</option>
                                    ${connectionOptionsHtml}
                                </select>
                                ${selectedConn ? `
                                    <button class="agent-goto-btn agent-goto-btn--inline" data-action="goto-connection"
                                            data-connection-id="${selectedConn.id}" title="编辑此连接的模型配置">
                                        → 编辑连接
                                    </button>
                                ` : ''}
                            </div>
                            <div id="conn-info-panel" style="margin-top:8px">
                                ${this.renderConnInfoPanel(selectedConn)}
                            </div>
                            ${connections.length === 0 ? `
                                <p class="agent-form-help" style="color:var(--st-color-warning,#f59e0b)">
                                    ⚠️ 所有连接均不可用，请先配置 API Key。
                                    <button class="agent-goto-btn" data-action="goto-providers">→ 前往 LLM Providers</button>
                                </p>
                            ` : noKeyConns.length > 0 ? `
                                <p class="agent-form-help">
                                    另有 ${noKeyConns.length} 个连接因 Provider 未配置 API Key 而不可用。
                                    <button class="agent-goto-btn" data-action="goto-providers">→ 配置 API Key</button>
                                </p>
                            ` : ''}
                        </div>

                        <div class="agent-form-row">
                            <label class="agent-form-label">
                                模型层级 <small>选择本次对话使用的质量/成本偏好</small>
                            </label>
                            <div class="agent-tier-selector" id="tier-selector">
                                ${(['optimal', 'standard', 'fast'] as ModelTier[]).map(t => {
                const meta: Record<ModelTier, { label: string; desc: string; icon: string }> = {
                    optimal:  { label: '最优', desc: '复杂推理',   icon: '💎' },
                    standard: { label: '标准', desc: '日常工作',   icon: '⚖️' },
                    fast:     { label: '快速', desc: '简单任务',   icon: '⚡' },
                };
                const m = meta[t];
                const modelName = this.resolveTierModelName(selectedConn, t);
                return `
                                    <button type="button" class="agent-tier-btn ${currentTier === t ? 'selected' : ''}" data-tier="${t}" title="${m.desc}">
                                        <span class="agent-tier-btn__icon">${m.icon}</span>
                                        <span class="agent-tier-btn__label">${m.label}</span>
                                        <span class="agent-tier-btn__model" id="tier-model-${t}">${modelName}</span>
                                    </button>`;
            }).join('')}
                            </div>
                            <input type="hidden" name="modelTier" id="model-tier-input" value="${currentTier}">
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

                <!-- Default Prompts -->
                <div class="agent-section">
                    <div class="agent-section__header">
                        <span class="agent-section__icon">💬</span>
                        <span class="agent-section__title">预设 Prompt</span>
                        <span class="agent-section__toggle">▼</span>
                    </div>
                    <div class="agent-section__body">
                        <p class="agent-form-help" style="margin-bottom:12px;">
                            预定义常用提示词。输入框可通过下拉框快速选择填入，支持调整顺序。
                        </p>
                        <div class="agent-prompt-list" id="prompt-list">
                            ${(agent.defaultPrompts || []).map((p, i) => this.renderPromptRow(p, i)).join('')}
                        </div>
                        <button type="button" class="agent-prompt-add" id="prompt-add">
                            ＋ 添加 Prompt
                        </button>
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

        // Non-critical: write resolved connection label to FSNode metadata for vfs-ui display.
        // Must run AFTER innerHTML is set so a failure here never breaks rendering.
        const engine = this.options.moduleFS;
        const nodeId = this.options.nodeId;
        if (engine?.driver && nodeId && selectedConn) {
            const connGroup = grouped.find(g => g.conns.some(c => c.id === selectedConn!.id));
            if (connGroup) {
                const label = `${connGroup.provider.icon ?? ''} ${connGroup.provider.name} · ${selectedConn.name}`.trim();
                engine.driver.updateMetadata(nodeId, { ai_connectionLabel: label }).catch(() => {});
            }
        }
    }

    /** 渲染单个预设 Prompt 行（name + prompt + 排序/删除操作） */
    private renderPromptRow(p: PromptPreset, index: number): string {
        return `
            <div class="agent-prompt-item" data-index="${index}">
                <div class="agent-prompt-item__head">
                    <input type="text"
                           class="agent-form-input agent-prompt-name"
                           placeholder="名称（如：代码审查）"
                           value="${this.escapeHtml(p.name)}">
                    <div class="agent-prompt-actions">
                        <button type="button" class="agent-prompt-btn" data-action="up" title="上移">▲</button>
                        <button type="button" class="agent-prompt-btn" data-action="down" title="下移">▼</button>
                        <button type="button" class="agent-prompt-btn agent-prompt-btn--danger" data-action="remove" title="删除">✕</button>
                    </div>
                </div>
                <textarea class="agent-form-textarea agent-prompt-text"
                          rows="2"
                          placeholder="提示词内容...">${this.escapeHtml(p.prompt)}</textarea>
            </div>
        `;
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
            this.emit('interactiveChange', undefined);
        };

        // Input/Select/Textarea 变更
        this.container.querySelectorAll('input, select, textarea').forEach(el => {
            el.addEventListener('input', handleChange);
            el.addEventListener('change', handleChange);
        });

        // 名称输入框 → 同步重命名 VFS 文件（复用 engine.rename + node:renamed 事件链）
        const nameInput = this.container.querySelector('.agent-header__name-input') as HTMLInputElement;
        const engine = this.options.moduleFS;
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

                // 修复：composite 和 workflow 类型隐藏 LLM 配置
                if (typeStr === 'composite' || typeStr === 'workflow') {
                    llmSection?.style.setProperty('display', 'none');
                    mcpSection?.style.setProperty('display', 'none');
                } else {
                    llmSection?.style.setProperty('display', 'block');
                    mcpSection?.style.setProperty('display', 'block');
                }

                // 更新内部状态
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
            connSelect.addEventListener('change', async () => {
                if (this.content?.config) this.content.config.connectionId = connSelect.value;
                // Update connection label in FSNode metadata for vfs-ui list display
                const engine = this.options.moduleFS;
                const nodeId = this.options.nodeId;
                if (engine?.driver && nodeId && connSelect.value) {
                    const selectedOpt = connSelect.options[connSelect.selectedIndex];
                    const groupLabel = (selectedOpt?.closest('optgroup') as HTMLOptGroupElement | null)?.label ?? '';
                    const label = groupLabel ? `${groupLabel} · ${selectedOpt.text.trim()}` : selectedOpt.text.trim();
                    engine.driver.updateMetadata(nodeId, { ai_connectionLabel: label }).catch(() => {});
                }
                await this.refreshConnInfo(connSelect.value);
                handleChange();
            });
        }

        // Navigate buttons (goto-providers / goto-connection) — delegated on container
        this.container.addEventListener('click', (e) => {
            const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement | null;
            if (!btn) return;
            const action = btn.dataset.action;
            if (action === 'goto-providers') {
                const providerId = btn.dataset.providerId;
                this.options.hostContext?.navigate?.({
                    target: 'settings',
                    resourceId: 'providers',
                    ...(providerId ? { state: { anchor: providerId } } : {}),
                });
            } else if (action === 'goto-connection') {
                const connId = btn.dataset.connectionId;
                this.options.hostContext?.navigate?.({
                    target: 'settings',
                    resourceId: 'connections',
                    ...(connId ? { state: { anchor: `conn:${connId}` } } : {}),
                });
            }
        });

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

        // Default Prompts 列表
        this.bindPromptEvents(handleChange);
    }

    /**
     * 绑定预设 Prompt 列表事件：添加、删除、上移、下移。
     *
     * 编辑（name/prompt 输入）已由全局 input/change 监听覆盖，
     * 这里仅处理需要重排 DOM 的操作（增删/排序），重排后重新索引并触发变更。
     */
    private bindPromptEvents(handleChange: () => void): void {
        const list = this.container.querySelector('#prompt-list');
        const addBtn = this.container.querySelector('#prompt-add');

        addBtn?.addEventListener('click', () => {
            // 先回写当前 DOM 状态，再追加空行重渲染，避免丢失未保存输入
            this.collectPromptsToContent();
            this.content?.defaultPrompts?.push({ name: '', prompt: '' });
            if (this.content && !this.content.defaultPrompts) {
                this.content.defaultPrompts = [{ name: '', prompt: '' }];
            }
            this.rerenderPromptList();
            handleChange();
        });

        list?.addEventListener('click', (e) => {
            const btn = (e.target as HTMLElement).closest('.agent-prompt-btn') as HTMLElement | null;
            if (!btn) return;
            const item = btn.closest('.agent-prompt-item') as HTMLElement | null;
            const index = parseInt(item?.dataset.index ?? '-1', 10);
            if (index < 0) return;

            this.collectPromptsToContent();
            const prompts = this.content?.defaultPrompts;
            if (!prompts) return;

            const action = btn.dataset.action;
            if (action === 'remove') {
                prompts.splice(index, 1);
            } else if (action === 'up' && index > 0) {
                [prompts[index - 1], prompts[index]] = [prompts[index], prompts[index - 1]];
            } else if (action === 'down' && index < prompts.length - 1) {
                [prompts[index + 1], prompts[index]] = [prompts[index], prompts[index + 1]];
            } else {
                return;
            }
            this.rerenderPromptList();
            handleChange();
        });

        // 行内编辑（name/prompt）— 委托监听，因 DOM 动态重建无法依赖全局绑定
        list?.addEventListener('input', (e) => {
            const target = e.target as HTMLElement;
            if (target.classList.contains('agent-prompt-name') ||
                target.classList.contains('agent-prompt-text')) {
                handleChange();
            }
        });
    }

    /** 重新渲染 Prompt 列表 DOM（增删/排序后调用） */
    private rerenderPromptList(): void {
        const list = this.container.querySelector('#prompt-list');
        if (!list) return;
        const prompts = this.content?.defaultPrompts ?? [];
        list.innerHTML = prompts.map((p, i) => this.renderPromptRow(p, i)).join('');
    }

    /** 从 DOM 读取当前 Prompt 行，回写到 this.content.defaultPrompts */
    private collectPromptsToContent(): void {
        if (!this.content) return;
        const rows = Array.from(this.container.querySelectorAll('.agent-prompt-item'));
        this.content.defaultPrompts = rows.map(row => ({
            name: (row.querySelector('.agent-prompt-name') as HTMLInputElement)?.value ?? '',
            prompt: (row.querySelector('.agent-prompt-text') as HTMLTextAreaElement)?.value ?? '',
        }));
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
                    this.emit('interactiveChange', undefined);
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
        // 修复：使用 normalizeAgentType 确保类型有效
        const type = this.normalizeAgentType(selectedType?.dataset.type);

        this.content.name = getVal('name');
        this.content.icon = getVal('icon');
        this.content.description = getVal('description');
        this.content.type = type;

        // 回写预设 Prompt 列表（过滤掉 name 和 prompt 均为空的行）
        this.collectPromptsToContent();
        this.content.defaultPrompts = (this.content.defaultPrompts ?? [])
            .filter(p => p.name.trim() !== '' || p.prompt.trim() !== '');

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

    /** 解析连接某个 tier 对应的模型显示名（未配置时返回空字符串） */
    private resolveTierModelName(conn: { providerId?: string; tiers?: Partial<Record<ModelTier, string>> } | undefined, tier: ModelTier): string {
        if (!conn?.tiers?.[tier]) return '';
        const pid = conn.providerId ?? '';
        const provider = this.service.getProviders().find(p => p.id === pid);
        const modelId = conn.tiers[tier]!;
        const modelDef = provider?.models.find(m => m.id === modelId);
        return modelDef ? modelDef.name : modelId;
    }

    /** 渲染连接信息面板：三个 tier 的模型名 + 能力 badges */
    private renderConnInfoPanel(conn?: { providerId?: string; tiers?: Partial<Record<ModelTier, string>> }): string {
        if (!conn) return '';
        const pid = conn.providerId ?? '';
        const provider = this.service.getProviders().find(p => p.id === pid);

        const tierMeta: Record<string, { label: string; cls: string }> = {
            optimal:  { label: '最优', cls: 'settings-tier-badge--optimal' },
            standard: { label: '标准', cls: 'settings-tier-badge--standard' },
            fast:     { label: '快速', cls: 'settings-tier-badge--fast' },
        };

        const rows = (['optimal', 'standard', 'fast'] as ModelTier[])
            .filter(t => conn.tiers?.[t])
            .map(t => {
                const modelId = conn.tiers![t]!;
                const modelDef = provider?.models.find(m => m.id === modelId);
                const name = modelDef ? modelDef.name : modelId;
                const caps = modelDef ? renderModelCapabilityBadges(modelDef) : '';
                const { label, cls } = tierMeta[t];
                return `<div style="display:flex;align-items:center;gap:6px;padding:3px 0">
                    <span class="settings-tier-badge ${cls}" style="flex-shrink:0">${label}</span>
                    <span style="font-size:0.8rem;color:var(--st-text-primary)">${this.escapeHtml(name)}</span>
                    ${caps ? `<span style="display:flex;gap:2px">${caps}</span>` : ''}
                </div>`;
            });

        if (rows.length === 0) {
            // No tiers configured — show the first model from provider
            const modelDef = provider?.models[0];
            const caps = modelDef ? renderModelCapabilityBadges(modelDef) : '';
            return `<div style="font-size:0.8rem;color:var(--st-text-secondary);display:flex;align-items:center;gap:6px">
                <span>模型：${this.escapeHtml(modelDef?.name ?? '未配置')}</span>
                ${caps ? `<span style="display:flex;gap:2px">${caps}</span>` : ''}
            </div>`;
        }

        return `<div style="background:var(--st-bg-secondary,#f8f9fa);border-radius:6px;padding:6px 10px;display:flex;flex-direction:column;gap:0">
            ${rows.join('')}
        </div>`;
    }

    /** 连接变更后刷新信息面板和 tier 按钮上的模型名 */
    private async refreshConnInfo(connId: string): Promise<void> {
        const allConns = await this.service.getConnections();
        const conn = allConns.find(c => c.id === connId);

        const panel = this.container.querySelector('#conn-info-panel') as HTMLElement | null;
        if (panel) panel.innerHTML = this.renderConnInfoPanel(conn);

        // Update model name shown on each tier button
        (['optimal', 'standard', 'fast'] as ModelTier[]).forEach(t => {
            const slot = this.container.querySelector(`#tier-model-${t}`) as HTMLElement | null;
            if (slot) slot.textContent = this.resolveTierModelName(conn, t);
        });

        // Update goto-connection button data attribute
        const gotoBtn = this.container.querySelector('[data-action="goto-connection"]') as HTMLElement | null;
        if (gotoBtn && conn) gotoBtn.dataset.connectionId = conn.id;
    }

    // --- IEditor Interface Implementation ---

    async destroy() {
        this.container.innerHTML = '';
        this.editorEvents.clear();
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
    on<E extends EditorEvent>(
        event: E,
        callback: EditorEventCallback<E>,
    ): () => void {
        return this.editorEvents.on(event, payload => callback(payload));
    }

    private emit<E extends EditorEvent>(event: E, payload: EditorEventMap[E]): void {
        this.editorEvents.emit(event, payload);
    }
}
