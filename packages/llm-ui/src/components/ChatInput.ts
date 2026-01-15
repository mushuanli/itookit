// @file llm-ui/components/ChatInput.ts

// @file: llm-ui/components/ChatInput.ts

/**
 * 聊天输入的完整状态（统一结构）
 * 包含所有可持久化的配置信息
 */
export interface ChatInputConfig {
    // === 输入内容 ===
    text: string;

    // === 当前选中的 Agent ===
    agentId: string;

    // === 会话级设置 ===
    settings: ChatSessionSettings;
}

/**
 * 会话级设置（可覆盖 Agent 默认配置）
 */
export interface ChatSessionSettings {
    modelId?: string;           // 覆盖默认模型
    historyLength: number;      // -1=不限制, 0=不发送历史
    temperature?: number;       // 温度参数
    streamMode: boolean;        // ✨ 新增：流式输出开关，默认 true
}

/**
 * 发送时的覆盖参数（从 settings 派生）
 */
export interface ChatOverrides {
    modelId?: string;
    historyLength?: number;
    temperature?: number;
    streamMode?: boolean;       // ✨ 新增
}

// 默认设置
export const DEFAULT_SESSION_SETTINGS: ChatSessionSettings = {
    modelId: undefined,
    historyLength: -1,
    temperature: undefined,
    streamMode: true,           // ✨ 默认开启流式
};

export interface ChatInputOptions {
    onSend: (text: string, files: File[], executorId: string, overrides?: ChatOverrides) => Promise<void>;
    onStop: () => void;
    onExecutorChange?: (executorId: string) => void;
    onConfigChange?: (config: ChatInputConfig) => void;
    
    // ✅ 修改：移除 initialModels，改为动态加载
    initialAgents?: ExecutorOption[];
    initialConfig?: Partial<ChatInputConfig>;
    
    // ✅ 新增：获取模型列表的回调
    onRequestModels?: (agentId: string) => Promise<ModelOption[]>;
}

export interface ExecutorOption {
    id: string;
    name: string;
    icon?: string;
    category?: string;
    description?: string;
}

// ✨ 新增：模型选项接口
export interface ModelOption {
    id: string;
    name: string;
    provider?: string;
    contextLength?: number;
    description?: string;
}

// ✨ 新增：聊天设置接口
export interface ChatSettings {
    modelId?: string;        // 覆盖默认模型
    historyLength: number;   // -1 表示不限制, 0 表示不发送历史
    temperature?: number;    // 温度参数
}

// ✨ 新增：发送时的覆盖参数
export interface ChatOverrides {
    modelId?: string;
    historyLength?: number;
    temperature?: number;
}

// ✨ 新增：状态接口
export interface ChatInputState {
    text: string;
    agentId: string;
    settings?: ChatSettings;  // ✨ 包含设置状态
}

export class ChatInput {
    private textarea!: HTMLTextAreaElement;
    private sendBtn!: HTMLButtonElement;
    private stopBtn!: HTMLButtonElement;
    private attachBtn!: HTMLButtonElement;
    private settingsBtn!: HTMLButtonElement;
    private executorSelect!: HTMLSelectElement;
    private modelSelect!: HTMLSelectElement;
    private historySlider!: HTMLInputElement;
    private historyValue!: HTMLSpanElement;
    private streamToggle!: HTMLInputElement;          // ✨ 新增
    private settingsPanel!: HTMLElement;
    private fileInput!: HTMLInputElement;
    private attachmentContainer!: HTMLElement;
    private inputWrapper!: HTMLElement;

    // === 状态 ===
    private loading = false;
    private files: File[] = [];
    private settingsExpanded = false;
    private models: ModelOption[] = [];
    private currentAgentId: string = 'default';
    private isLoadingModels: boolean = false;

    // ✨ 统一配置对象
    private config: ChatInputConfig = {
        text: '',
        agentId: 'default',
        settings: { ...DEFAULT_SESSION_SETTINGS }
    };

    constructor(private container: HTMLElement, private options: ChatInputOptions) {
        // 合并初始配置
        if (options.initialConfig) {
            this.config = this.mergeConfig(this.config, options.initialConfig);
        }
        this.currentAgentId = this.config.agentId;

        this.render();
        this.bindEvents();
        this.initExecutors();
        this.syncUIFromConfig();
        
        // ✅ 初始加载当前 Agent 的模型
        this.loadModelsForAgent(this.currentAgentId);
    }

    /**
     * 合并配置（深度合并 settings）
     */
    private mergeConfig(base: ChatInputConfig, partial: Partial<ChatInputConfig>): ChatInputConfig {
        return {
            text: partial.text ?? base.text,
            agentId: partial.agentId ?? base.agentId,
            settings: {
                ...base.settings,
                ...(partial.settings || {})
            }
        };
    }

    private initExecutors(): void {
        if (this.options.initialAgents && this.options.initialAgents.length > 0) {
            this.updateExecutors(this.options.initialAgents);
        } else {
            this.updateExecutors([{ id: 'default', name: 'Assistant', category: 'System' }]);
        }
    }

    /**
     * ✅ 新增：加载指定 Agent 的可用模型
     */
    private async loadModelsForAgent(agentId: string): Promise<void> {
        if (!this.options.onRequestModels) {
            console.warn('[ChatInput] onRequestModels not provided');
            return;
        }

        if (this.isLoadingModels) return;
        
        this.isLoadingModels = true;
        this.setModelSelectLoading(true);

        try {
            const models = await this.options.onRequestModels(agentId);
            this.models = models;
            this.updateModelOptions();
            
            // 如果当前选中的模型不在新列表中，清除选择
            if (this.config.settings.modelId) {
                const stillExists = models.some(m => m.id === this.config.settings.modelId);
                if (!stillExists) {
                    this.config.settings.modelId = undefined;
                    this.modelSelect.value = '';
                    this.updateActiveBadges();
                }
            }
            
        } catch (e) {
            console.error('[ChatInput] Failed to load models:', e);
            this.models = [];
            this.updateModelOptions();
        } finally {
            this.isLoadingModels = false;
            this.setModelSelectLoading(false);
        }
    }

    /**
     * ✅ 新增：设置模型选择器加载状态
     */
    private setModelSelectLoading(loading: boolean): void {
        if (!this.modelSelect) return;
        
        this.modelSelect.disabled = loading;
        
        if (loading) {
            this.modelSelect.innerHTML = '<option value="">Loading models...</option>';
        }
    }

    /**
     * 将当前 config 同步到 UI 元素
     */
    private syncUIFromConfig(): void {
        // Text
        if (this.textarea) {
            this.textarea.value = this.config.text;
            this.adjustTextareaHeight();
        }

        // Agent
        if (this.executorSelect) {
            this.setExecutorValue(this.config.agentId);
        }

        // Model
        if (this.modelSelect && this.config.settings.modelId) {
            this.modelSelect.value = this.config.settings.modelId;
        }

        // History
        if (this.historySlider) {
            this.historySlider.value = this.config.settings.historyLength.toString();
            this.updateHistoryDisplay();
            this.updatePresetButtons();
        }

        // Stream Mode
        if (this.streamToggle) {
            this.streamToggle.checked = this.config.settings.streamMode;
        }

        // Badges
        this.updateActiveBadges();
    }

    /**
     * 从 UI 元素同步到 config
     */
    private syncConfigFromUI(): void {
        this.config.text = this.textarea?.value || '';
        this.config.agentId = this.executorSelect?.value || 'default';
        this.config.settings.modelId = this.modelSelect?.value || undefined;
        this.config.settings.historyLength = parseInt(this.historySlider?.value || '-1');
        this.config.settings.streamMode = this.streamToggle?.checked ?? true;
    }

    private render() {
        this.container.innerHTML = `
            <div class="llm-input">
                <!-- 设置面板 -->
                <div class="llm-input__settings-panel" style="display: none;">
                    <div class="llm-input__settings-header">
                        <span class="llm-input__settings-title">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="3"></circle>
                                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                            </svg>
                            Chat Settings
                        </span>
                        <button class="llm-input__settings-close" title="Close settings">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="18" y1="6" x2="6" y2="18"></line>
                                <line x1="6" y1="6" x2="18" y2="18"></line>
                            </svg>
                        </button>
                    </div>
                    
                    <div class="llm-input__settings-body">
                        <!-- Model Override -->
                        <div class="llm-input__setting-row">
                            <label class="llm-input__setting-label">
                                <span class="llm-input__setting-icon">🧠</span>
                                Model Override
                            </label>
                            <select class="llm-input__model-select" title="Override model for this chat">
                                <option value="">Use Agent Default</option>
                            </select>
                            <span class="llm-input__setting-hint">Temporarily use a different model</span>
                        </div>

                        <!-- ✨ 新增：Stream Mode Toggle -->
                        <div class="llm-input__setting-row">
                            <label class="llm-input__setting-label">
                                <span class="llm-input__setting-icon">⚡</span>
                                Stream Mode
                            </label>
                            <div class="llm-input__toggle-wrapper">
                                <label class="llm-input__toggle">
                                    <input type="checkbox" 
                                           class="llm-input__stream-toggle" 
                                           checked
                                           title="Enable streaming output">
                                    <span class="llm-input__toggle-slider"></span>
                                </label>
                                <span class="llm-input__toggle-label">Enabled</span>
                            </div>
                            <span class="llm-input__setting-hint">Show response as it generates</span>
                        </div>

                        <!-- History Length -->
                        <div class="llm-input__setting-row">
                            <label class="llm-input__setting-label">
                                <span class="llm-input__setting-icon">📜</span>
                                History Context
                                <span class="llm-input__history-value">Unlimited</span>
                            </label>
                            <div class="llm-input__slider-wrapper">
                                <input type="range" 
                                       class="llm-input__history-slider" 
                                       min="-1" 
                                       max="50" 
                                       value="-1"
                                       title="Number of messages to include">
                                <div class="llm-input__slider-labels">
                                    <span>None</span>
                                    <span>Unlimited</span>
                                </div>
                            </div>
                            <span class="llm-input__setting-hint">How many previous messages to send</span>
                        </div>

                        <!-- Quick Presets -->
                        <div class="llm-input__setting-row llm-input__presets">
                            <span class="llm-input__setting-label">Quick presets:</span>
                            <div class="llm-input__preset-buttons">
                                <button class="llm-input__preset-btn" data-history="0" title="No history context">
                                    Fresh Start
                                </button>
                                <button class="llm-input__preset-btn" data-history="5" title="Last 5 messages">
                                    Short (5)
                                </button>
                                <button class="llm-input__preset-btn" data-history="20" title="Last 20 messages">
                                    Medium (20)
                                </button>
                                <button class="llm-input__preset-btn active" data-history="-1" title="All messages">
                                    Full
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 主输入区域 -->
                <div class="llm-input__main">
                    <!-- 左侧：执行器选择 -->
                    <div class="llm-input__executor-wrapper">
                        <select class="llm-input__executor-select" title="Select Agent/Executor">
                            <option value="default">🤖 Assistant</option>
                        </select>
                    </div>

                    <!-- 中间：输入区域 + 附件预览 -->
                    <div class="llm-input__field-wrapper">
                        <div class="llm-input__attachments" style="display:none"></div>
                        
                        <!-- ✨ 新增：活动设置指示器 -->
                        <div class="llm-input__active-settings" style="display:none">
                            <span class="llm-input__active-badge" data-type="model" style="display:none">
                                🧠 <span class="llm-input__badge-text"></span>
                                <button class="llm-input__badge-clear" data-clear="model">×</button>
                            </span>
                            <span class="llm-input__active-badge" data-type="stream" style="display:none">
                                ⏸️ <span class="llm-input__badge-text">Non-stream</span>
                                <button class="llm-input__badge-clear" data-clear="stream">×</button>
                            </span>
                            <span class="llm-input__active-badge" data-type="history" style="display:none">
                                📜 <span class="llm-input__badge-text"></span>
                                <button class="llm-input__badge-clear" data-clear="history">×</button>
                            </span>
                        </div>
                        
                        <textarea 
                            class="llm-input__textarea" 
                            placeholder="Message... (Paste images or Drag & Drop)" 
                            rows="1"
                        ></textarea>
                    </div>

                    <!-- 右侧：操作按钮 -->
                    <div class="llm-input__actions">
                        <!-- ✨ 新增：设置按钮 -->
                        <button class="llm-input__btn llm-input__btn--settings" title="Chat Settings">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="4" y1="21" x2="4" y2="14"></line>
                                <line x1="4" y1="10" x2="4" y2="3"></line>
                                <line x1="12" y1="21" x2="12" y2="12"></line>
                                <line x1="12" y1="8" x2="12" y2="3"></line>
                                <line x1="20" y1="21" x2="20" y2="16"></line>
                                <line x1="20" y1="12" x2="20" y2="3"></line>
                                <line x1="1" y1="14" x2="7" y2="14"></line>
                                <line x1="9" y1="8" x2="15" y2="8"></line>
                                <line x1="17" y1="16" x2="23" y2="16"></line>
                            </svg>
                        </button>
                        
                        <button class="llm-input__btn llm-input__btn--attach" title="Attach File">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                        </button>
                        
                        <button class="llm-input__btn llm-input__btn--send" title="Send">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                        </button>
                        
                        <button class="llm-input__btn llm-input__btn--stop" title="Stop Generation" style="display:none;">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect></svg>
                        </button>
                    </div>
                </div>

                <input type="file" multiple style="display:none;" id="llm-ui-hidden-file-input">
            </div>
        `;

        this.bindElements();
        this.updateModelOptions();
        this.updateHistoryDisplay();
    }

    /**
     * 绑定 DOM 元素引用
     */
    private bindElements(): void {
        this.textarea = this.container.querySelector('.llm-input__textarea')!;
        this.sendBtn = this.container.querySelector('.llm-input__btn--send')!;
        this.stopBtn = this.container.querySelector('.llm-input__btn--stop')!;
        this.attachBtn = this.container.querySelector('.llm-input__btn--attach')!;
        this.settingsBtn = this.container.querySelector('.llm-input__btn--settings')!;
        this.executorSelect = this.container.querySelector('.llm-input__executor-select')!;
        this.modelSelect = this.container.querySelector('.llm-input__model-select')!;
        this.historySlider = this.container.querySelector('.llm-input__history-slider')!;
        this.historyValue = this.container.querySelector('.llm-input__history-value')!;
        this.streamToggle = this.container.querySelector('.llm-input__stream-toggle')!;
        this.settingsPanel = this.container.querySelector('.llm-input__settings-panel')!;
        this.fileInput = this.container.querySelector('#llm-ui-hidden-file-input')!;
        this.attachmentContainer = this.container.querySelector('.llm-input__attachments')!;
        this.inputWrapper = this.container.querySelector('.llm-input__field-wrapper')!;
    }

    private bindEvents(): void {
        // === 文本输入 ===
        this.textarea.addEventListener('input', () => {
            this.adjustTextareaHeight();
            this.config.text = this.textarea.value;
            this.notifyConfigChange();
        });

        this.textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.triggerSend();
            }
        });

        // ✨ 3. 增强：粘贴事件监听 (Paste Support)
        this.textarea.addEventListener('paste', (e) => this.handlePaste(e));

        // ✨ 4. 增强：拖拽事件监听 (Drag & Drop Support)
        this.bindDragEvents();

        // 5. 按钮事件
        this.sendBtn.addEventListener('click', () => this.triggerSend());
        this.stopBtn.addEventListener('click', () => this.options.onStop());

        // 4. 附件处理
        this.attachBtn.addEventListener('click', () => this.fileInput.click());

        // ✨ 5. 设置按钮
        this.settingsBtn.addEventListener('click', () => this.toggleSettings());

        // ✨ 6. 设置面板关闭按钮
        this.container.querySelector('.llm-input__settings-close')?.addEventListener('click', () => {
            this.toggleSettings(false);
        });

        // 7. 文件输入
        this.fileInput.addEventListener('change', () => {
            if (this.fileInput.files) {
                this.addFiles(Array.from(this.fileInput.files));
                this.fileInput.value = ''; // Reset
            }
        });

        // === Agent 选择 ===
        this.executorSelect.addEventListener('change', async () => {
            const newAgentId = this.executorSelect.value;
            this.config.agentId = newAgentId;
            
            // ✅ 关键：切换 Agent 时重新加载模型列表
            if (newAgentId !== this.currentAgentId) {
                this.currentAgentId = newAgentId;
                
                // 清除之前的模型选择（因为不同 Agent 的 Connection 不同）
                this.config.settings.modelId = undefined;
                this.modelSelect.value = '';
                
                await this.loadModelsForAgent(newAgentId);
            }
            
            this.options.onExecutorChange?.(newAgentId);
            this.notifyConfigChange();
        });

        // === 设置面板 ===
        this.modelSelect.addEventListener('change', () => {
            this.config.settings.modelId = this.modelSelect.value || undefined;
            this.updateActiveBadges();
            this.notifyConfigChange();
        });

        this.historySlider.addEventListener('input', () => {
            this.config.settings.historyLength = parseInt(this.historySlider.value);
            this.updateHistoryDisplay();
            this.updatePresetButtons();
            this.updateActiveBadges();
        });

        this.historySlider.addEventListener('change', () => {
            this.notifyConfigChange();
        });

        // ✨ 新增：Stream Mode Toggle
        this.streamToggle.addEventListener('change', () => {
            this.config.settings.streamMode = this.streamToggle.checked;
            this.updateStreamToggleLabel();
            this.updateActiveBadges();
            this.notifyConfigChange();
        });

        // === 预设按钮 ===
        this.container.querySelectorAll('.llm-input__preset-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const value = parseInt((e.currentTarget as HTMLElement).dataset.history || '-1');
                this.historySlider.value = value.toString();
                this.config.settings.historyLength = value;
                this.updateHistoryDisplay();
                this.updatePresetButtons();
                this.updateActiveBadges();
                this.notifyConfigChange();
            });
        });

        // === Badge 清除按钮 ===
        this.container.querySelectorAll('.llm-input__badge-clear').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const clearType = (e.currentTarget as HTMLElement).dataset.clear;
                this.clearSetting(clearType as 'model' | 'history' | 'stream');
            });
        });

        // === 点击外部关闭设置 ===
        document.addEventListener('click', (e) => {
            if (this.settingsExpanded) {
                const target = e.target as HTMLElement;
                if (!this.settingsPanel.contains(target) && !this.settingsBtn.contains(target)) {
                    this.toggleSettings(false);
                }
            }
        });
    }

    /**
     * 清除指定设置
     */
    private clearSetting(type: 'model' | 'history' | 'stream'): void {
        switch (type) {
            case 'model':
                this.modelSelect.value = '';
                this.config.settings.modelId = undefined;
                break;
            case 'history':
                this.historySlider.value = '-1';
                this.config.settings.historyLength = -1;
                this.updateHistoryDisplay();
                this.updatePresetButtons();
                break;
            case 'stream':
                this.streamToggle.checked = true;
                this.config.settings.streamMode = true;
                this.updateStreamToggleLabel();
                break;
        }
        this.updateActiveBadges();
        this.notifyConfigChange();
    }

    /**
     * 更新 Stream Toggle 标签
     */
    private updateStreamToggleLabel(): void {
        const label = this.container.querySelector('.llm-input__toggle-label');
        if (label) {
            label.textContent = this.config.settings.streamMode ? 'Enabled' : 'Disabled';
        }
    }

    /**
     * 切换设置面板
     */
    private toggleSettings(show?: boolean): void {
        this.settingsExpanded = show ?? !this.settingsExpanded;
        this.settingsPanel.style.display = this.settingsExpanded ? 'block' : 'none';
        this.settingsBtn.classList.toggle('active', this.settingsExpanded);

        // 添加动画效果
        if (this.settingsExpanded) {
            this.settingsPanel.classList.add('llm-input__settings-panel--entering');
            requestAnimationFrame(() => {
                this.settingsPanel.classList.remove('llm-input__settings-panel--entering');
            });
        }
    }

    /**
     * 更新历史长度显示
     */
    private updateHistoryDisplay(): void {
        const value = this.config.settings.historyLength;
        if (value === -1) {
            this.historyValue.textContent = 'Unlimited';
        } else if (value === 0) {
            this.historyValue.textContent = 'None';
        } else {
            this.historyValue.textContent = `${value} messages`;
        }
    }

    /**
     * 更新预设按钮状态
     */
    private updatePresetButtons(): void {
        const value = this.config.settings.historyLength;
        this.container.querySelectorAll('.llm-input__preset-btn').forEach(btn => {
            const btnValue = parseInt((btn as HTMLElement).dataset.history || '-1');
            btn.classList.toggle('active', btnValue === value);
        });
    }

    /**
     * 更新活动设置徽章
     */
    private updateActiveBadges(): void {
        const activeContainer = this.container.querySelector('.llm-input__active-settings') as HTMLElement;
        const modelBadge = this.container.querySelector('.llm-input__active-badge[data-type="model"]') as HTMLElement;
        const streamBadge = this.container.querySelector('.llm-input__active-badge[data-type="stream"]') as HTMLElement;
        const historyBadge = this.container.querySelector('.llm-input__active-badge[data-type="history"]') as HTMLElement;

        let hasActiveSettings = false;

        // Model badge
        if (this.config.settings.modelId) {
            const model = this.models.find(m => m.id === this.config.settings.modelId);
            const text = modelBadge.querySelector('.llm-input__badge-text');
            if (text) text.textContent = model?.name || this.config.settings.modelId;
            modelBadge.style.display = 'inline-flex';
            hasActiveSettings = true;
        } else {
            modelBadge.style.display = 'none';
        }

        // ✨ Stream badge (只在关闭时显示)
        if (!this.config.settings.streamMode) {
            streamBadge.style.display = 'inline-flex';
            hasActiveSettings = true;
        } else {
            streamBadge.style.display = 'none';
        }

        // History badge
        if (this.config.settings.historyLength !== -1) {
            const text = historyBadge.querySelector('.llm-input__badge-text');
            if (text) {
                text.textContent = this.config.settings.historyLength === 0
                    ? 'No history'
                    : `${this.config.settings.historyLength} msgs`;
            }
            historyBadge.style.display = 'inline-flex';
            hasActiveSettings = true;
        } else {
            historyBadge.style.display = 'none';
        }

        activeContainer.style.display = hasActiveSettings ? 'flex' : 'none';
        this.settingsBtn.classList.toggle('has-overrides', hasActiveSettings);
    }

    /**
     * 通知配置变化
     */
    private notifyConfigChange(): void {
        this.options.onConfigChange?.(this.getConfig());
    }

    /**
     * 调整文本框高度
     */
    private adjustTextareaHeight(): void {
        this.textarea.style.height = 'auto';
        const newHeight = Math.min(this.textarea.scrollHeight, 200);
        this.textarea.style.height = `${newHeight}px`;
    }

    /**
     * 触发发送
     */
    private async triggerSend(): Promise<void> {
        const text = this.textarea.value.trim();
        if ((!text && this.files.length === 0) || this.loading) return;

        const currentExecutor = this.config.agentId;
        const currentFiles = [...this.files];

        // 构建覆盖参数
        const overrides: ChatOverrides = {};
        if (this.config.settings.modelId) {
            overrides.modelId = this.config.settings.modelId;
        }
        if (this.config.settings.historyLength !== -1) {
            overrides.historyLength = this.config.settings.historyLength;
        }
        if (this.config.settings.temperature !== undefined) {
            overrides.temperature = this.config.settings.temperature;
        }
        // ✅ 关键：传递 streamMode
        if (!this.config.settings.streamMode) {
            overrides.streamMode = false;
        }

        // Reset UI
        this.textarea.value = '';
        this.textarea.style.height = 'auto';
        this.config.text = '';
        this.files = [];
        this.renderAttachments();

        await this.options.onSend(text, currentFiles, currentExecutor, overrides);
    }

    // ================================================================
    // 附件处理
    // ================================================================

    private handlePaste(e: ClipboardEvent): void {
        if (this.loading) return;

        const items = e.clipboardData?.items;
        if (!items) return;

        const pastedFiles: File[] = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind === 'file') {
                const file = item.getAsFile();
                if (file) {
                    pastedFiles.push(this.renameFileIfNeeded(file));
                }
            }
        }

        if (pastedFiles.length > 0) {
            // 如果粘贴包含文件，阻止默认行为（防止有些浏览器尝试在 textarea 显示图片乱码）
            // 但如果同时包含文本，我们通常希望文本能进去。
            // 现代浏览器中，粘贴文件不会影响文本粘贴，除非我们 preventDefault。
            // 这里我们只处理文件，文本让浏览器默认处理。
            this.addFiles(pastedFiles);
        }
    }

    private bindDragEvents(): void {
        const wrapper = this.inputWrapper;

        // 拖入
        wrapper.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!this.loading) {
                wrapper.classList.add('llm-input__field-wrapper--drag-active');
            }
        });

        // 拖出
        wrapper.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            wrapper.classList.remove('llm-input__field-wrapper--drag-active');
        });

        // 放下
        wrapper.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            wrapper.classList.remove('llm-input__field-wrapper--drag-active');

            if (this.loading) return;

            const droppedFiles = e.dataTransfer?.files;
            if (droppedFiles && droppedFiles.length > 0) {
                this.addFiles(Array.from(droppedFiles));
            }
        });
    }

    /**
     * ✨ 辅助：重命名截图文件
     */
    private renameFileIfNeeded(file: File): File {
        if (file.name === 'image.png' || file.name === 'image.jpg') {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const newName = `paste_${timestamp}.${file.name.split('.').pop()}`;
            return new File([file], newName, { type: file.type });
        }
        return file;
    }

    private addFiles(newFiles: File[]): void {
        this.files = [...this.files, ...newFiles];
        this.renderAttachments();
    }

    private removeFile(index: number): void {
        this.files.splice(index, 1);
        this.renderAttachments();
    }

    private renderAttachments(): void {
        if (this.files.length === 0) {
            this.attachmentContainer.style.display = 'none';
            return;
        }

        this.attachmentContainer.style.display = 'flex';
        this.attachmentContainer.innerHTML = this.files.map((f, i) => `
            <div class="llm-input__attachment-tag">
                <span class="llm-input__file-icon">
                   ${f.type.startsWith('image/') ? '🖼️' : '📄'}
                </span>
                <span class="llm-input__filename">${f.name}</span>
                <span class="llm-input__filesize">(${this.formatSize(f.size)})</span>
                <span class="llm-input__remove-btn" data-index="${i}" title="Remove">×</span>
            </div>
        `).join('');

        this.attachmentContainer.querySelectorAll('.llm-input__remove-btn').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation(); // 防止触发输入框聚焦
                const idx = parseInt((e.target as HTMLElement).dataset.index!);
                this.removeFile(idx);
            });
        });
    }

    // ✨ 辅助：格式化文件大小
    private formatSize(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    // ================================================================
    // 模型与执行器管理
    // ================================================================

    private updateModelOptions(): void {
        let html = '<option value="">Use Agent Default</option>';
        
        // 不再分组，因为只显示单个 Connection 的模型
        this.models.forEach(model => {
            const displayName = model.provider 
                ? `${model.name} (${model.provider})`
                : model.name;
            html += `<option value="${model.id}">${displayName}</option>`;
        });
        
        this.modelSelect.innerHTML = html;
        
        // 恢复选中状态
        if (this.config.settings.modelId) {
            const exists = this.models.some(m => m.id === this.config.settings.modelId);
            if (exists) {
                this.modelSelect.value = this.config.settings.modelId;
            }
        }
    }


    // ✨ 新增：更新模型选项
    public updateModels(models: ModelOption[]): void {
        const previousModelId = this.config.settings.modelId;
        this.models = models;
        this.updateModelOptions();

        // ✅ 恢复之前的选中状态（如果模型仍然存在）
        if (previousModelId) {
            const stillExists = models.some(m => m.id === previousModelId);
            if (stillExists) {
                this.modelSelect.value = previousModelId;
            } else {
                this.config.settings.modelId = undefined;
                this.updateActiveBadges();
            }
        }
    }

    public updateExecutors(executors: ExecutorOption[], activeId?: string): void {
        const groups: Record<string, ExecutorOption[]> = {};
        const uncategorized: ExecutorOption[] = [];

        executors.forEach(e => {
            if (e.category) {
                if (!groups[e.category]) groups[e.category] = [];
                groups[e.category].push(e);
            } else {
                uncategorized.push(e);
            }
        });

        let html = '';

        // 1. 未分类 (Default agents)
        if (uncategorized.length > 0) {
            html += uncategorized.map(e => this.renderOption(e)).join('');
        }

        // 2. 分类组
        Object.entries(groups).forEach(([category, items]) => {
            html += `<optgroup label="${category}">`;
            html += items.map(e => this.renderOption(e)).join('');
            html += `</optgroup>`;
        });

        this.executorSelect.innerHTML = html;

        if (activeId) {
            this.setExecutor(activeId);
        }
    }

    private renderOption(e: ExecutorOption): string {
        const icon = e.icon ? `${e.icon} ` : '';
        return `<option value="${e.id}">${icon}${e.name}</option>`;
    }

    private setExecutorValue(id: string): void {
        const option = this.executorSelect.querySelector(`option[value="${id}"]`);
        if (option) {
            this.executorSelect.value = id;
        } else {
            this.executorSelect.value = 'default';
        }
    }

    // ================================================================
    // 公共 API
    // ================================================================

    /**
     * 获取完整配置
     */
    public getConfig(): ChatInputConfig {
        this.syncConfigFromUI();
        return {
            text: this.config.text,
            agentId: this.config.agentId,
            settings: { ...this.config.settings }
        };
    }

    /**
     * 设置完整配置
     */
    public setConfig(config: Partial<ChatInputConfig>): void {
        this.config = this.mergeConfig(this.config, config);
        this.syncUIFromConfig();
        
        // 如果 agentId 变了，重新加载模型
        if (config.agentId && config.agentId !== this.currentAgentId) {
            this.currentAgentId = config.agentId;
            this.loadModelsForAgent(config.agentId);
        }
    }

    /**
     * ✅ 新增：强制刷新模型列表
     */
    public async refreshModels(): Promise<void> {
        await this.loadModelsForAgent(this.currentAgentId);
    }

    /**
     * 获取当前选中的执行器 ID
     */
    public getSelectedExecutor(): string {
        return this.config.agentId;
    }

    /**
     * 设置选中的执行器
     */
    public setExecutor(id: string): void {
        this.config.agentId = id;
        this.setExecutorValue(id);
    }

    /**
     * 设置输入文本
     */
    public setInput(text: string): void {
        this.config.text = text;
        if (this.textarea) {
            this.textarea.value = text;
            this.adjustTextareaHeight();
        }
    }

    /**
     * 获取会话设置
     */
    public getSettings(): ChatSessionSettings {
        return { ...this.config.settings };
    }

    /**
     * 设置会话设置
     */
    public setSettings(settings: Partial<ChatSessionSettings>): void {
        this.config.settings = { ...this.config.settings, ...settings };
        this.syncUIFromConfig();
    }

    /**
     * 重置设置为默认值
     */
    public resetSettings(): void {
        this.config.settings = { ...DEFAULT_SESSION_SETTINGS };
        this.syncUIFromConfig();
        this.notifyConfigChange();
    }

    /**
     * 设置加载状态
     */
    public setLoading(loading: boolean): void {
        this.loading = loading;
        this.sendBtn.style.display = loading ? 'none' : 'flex';
        this.stopBtn.style.display = loading ? 'flex' : 'none';
        this.textarea.disabled = loading;
        this.executorSelect.disabled = loading;
        this.attachBtn.disabled = loading;
        this.settingsBtn.disabled = loading;

        if (loading) {
            this.inputWrapper.classList.add('llm-input__field-wrapper--disabled');
            this.toggleSettings(false);
        } else {
            this.inputWrapper.classList.remove('llm-input__field-wrapper--disabled');
        }
    }

    /**
     * 聚焦输入框
     */
    public focus(): void {
        this.textarea?.focus();
    }

    /**
     * 销毁组件
     */
    public destroy(): void {
        this.container.innerHTML = '';
        this.files = [];
    }

    // ================================================================
    // 兼容性 API（向后兼容）
    // ================================================================

    /** @deprecated 使用 getConfig() 代替 */
    public getState(): ChatInputConfig {
        return this.getConfig();
    }

    /** @deprecated 使用 setConfig() 代替 */
    public setState(state: Partial<ChatInputConfig>): void {
        this.setConfig(state);
    }
}
