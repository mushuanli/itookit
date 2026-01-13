// @file llm-ui/components/ChatInput.ts

export interface ChatInputOptions {
    onSend: (text: string, files: File[], executorId: string, overrides?: ChatOverrides) => Promise<void>;
    onStop: () => void;
    onExecutorChange?: (executorId: string) => void;
    onInputChange?: () => void;
    onSettingsChange?: (settings: ChatSettings) => void;  // ✨ 新增：设置变化回调
    initialAgents?: ExecutorOption[];
    initialModels?: ModelOption[];  // ✨ 新增：初始模型列表
    initialSettings?: ChatSettings; // ✨ 新增：初始设置
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
    private settingsBtn!: HTMLButtonElement;      // ✨ 新增
    private executorSelect!: HTMLSelectElement;
    private modelSelect!: HTMLSelectElement;       // ✨ 新增
    private historySlider!: HTMLInputElement;      // ✨ 新增
    private historyValue!: HTMLSpanElement;        // ✨ 新增
    private settingsPanel!: HTMLElement;           // ✨ 新增
    private fileInput!: HTMLInputElement;
    private attachmentContainer!: HTMLElement;
    private inputWrapper!: HTMLElement;
    
    private loading = false;
    private files: File[] = [];
    private settingsExpanded = false;              // ✨ 新增
    private models: ModelOption[] = [];            // ✨ 新增
    
    // ✨ 新增：当前设置
    private currentSettings: ChatSettings = {
        modelId: undefined,
        historyLength: -1,
        temperature: undefined
    };

    constructor(private container: HTMLElement, private options: ChatInputOptions) {
        // ✨ 初始化设置
        if (options.initialSettings) {
            this.currentSettings = { ...this.currentSettings, ...options.initialSettings };
        }
        if (options.initialModels) {
            this.models = options.initialModels;
        }
        
        this.render();
        this.bindEvents();

        // ✨ 2. 新增初始化逻辑 (在 bindEvents 之后)
        // 如果传入了初始列表，立即渲染
        if (this.options.initialAgents && this.options.initialAgents.length > 0) {
            this.updateExecutors(this.options.initialAgents);
        } else {
            // 否则渲染一个默认的
            this.updateExecutors([{ id: 'default', name: 'Assistant', category: 'System' }]);
        }
    }

    private render() {
        this.container.innerHTML = `
            <div class="llm-input">
                <!-- ✨ 新增：设置面板 -->
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

        // 绑定元素引用
        this.textarea = this.container.querySelector('.llm-input__textarea')!;
        this.sendBtn = this.container.querySelector('.llm-input__btn--send')!;
        this.stopBtn = this.container.querySelector('.llm-input__btn--stop')!;
        this.attachBtn = this.container.querySelector('.llm-input__btn--attach')!;
        this.settingsBtn = this.container.querySelector('.llm-input__btn--settings')!;
        this.executorSelect = this.container.querySelector('.llm-input__executor-select')!;
        this.modelSelect = this.container.querySelector('.llm-input__model-select')!;
        this.historySlider = this.container.querySelector('.llm-input__history-slider')!;
        this.historyValue = this.container.querySelector('.llm-input__history-value')!;
        this.settingsPanel = this.container.querySelector('.llm-input__settings-panel')!;
        this.fileInput = this.container.querySelector('#llm-ui-hidden-file-input')!;
        this.attachmentContainer = this.container.querySelector('.llm-input__attachments')!;
        this.inputWrapper = this.container.querySelector('.llm-input__field-wrapper')!;
        
        // 初始化模型列表
        this.updateModelOptions();
        // 初始化历史滑块
        this.updateHistoryDisplay();
    }

    private bindEvents() {
        // 1. 自动高度调整
        const adjustHeight = () => {
            this.textarea.style.height = 'auto';
            const newHeight = Math.min(this.textarea.scrollHeight, 200); // Max height 200px
            this.textarea.style.height = `${newHeight}px`;
        };

        // ✨ 修改：input 事件同时触发高度调整和变化通知
        this.textarea.addEventListener('input', () => {
            adjustHeight();
            this.options.onInputChange?.();  // ✨ 通知外部
        });
        
        this.textarea.addEventListener('change', adjustHeight);

        // 2. 键盘事件
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

        // 8. Executor 变化
        this.executorSelect.addEventListener('change', () => {
            this.options.onExecutorChange?.(this.executorSelect.value);
        });

        // ✨ 9. Model 选择变化
        this.modelSelect.addEventListener('change', () => {
            this.currentSettings.modelId = this.modelSelect.value || undefined;
            this.updateActiveBadges();
            this.notifySettingsChange();
        });

        // ✨ 10. History 滑块变化
        this.historySlider.addEventListener('input', () => {
            const value = parseInt(this.historySlider.value);
            this.currentSettings.historyLength = value;
            this.updateHistoryDisplay();
            this.updatePresetButtons();
            this.updateActiveBadges();
        });
        
        this.historySlider.addEventListener('change', () => {
            this.notifySettingsChange();
        });

        // ✨ 11. 预设按钮
        this.container.querySelectorAll('.llm-input__preset-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const value = parseInt((e.currentTarget as HTMLElement).dataset.history || '-1');
                this.historySlider.value = value.toString();
                this.currentSettings.historyLength = value;
                this.updateHistoryDisplay();
                this.updatePresetButtons();
                this.updateActiveBadges();
                this.notifySettingsChange();
            });
        });

        // ✨ 12. Badge 清除按钮
        this.container.querySelectorAll('.llm-input__badge-clear').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const clearType = (e.currentTarget as HTMLElement).dataset.clear;
                if (clearType === 'model') {
                    this.modelSelect.value = '';
                    this.currentSettings.modelId = undefined;
                } else if (clearType === 'history') {
                    this.historySlider.value = '-1';
                    this.currentSettings.historyLength = -1;
                    this.updateHistoryDisplay();
                    this.updatePresetButtons();
                }
                this.updateActiveBadges();
                this.notifySettingsChange();
            });
        });

        // ✨ 13. 点击外部关闭设置面板
        document.addEventListener('click', (e) => {
            if (this.settingsExpanded) {
                const target = e.target as HTMLElement;
                const isInsidePanel = this.settingsPanel.contains(target);
                const isSettingsBtn = this.settingsBtn.contains(target);
                
                if (!isInsidePanel && !isSettingsBtn) {
                    this.toggleSettings(false);
                }
            }
        });
    }

    // ✨ 新增：切换设置面板
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

    // ✨ 新增：更新历史显示
    private updateHistoryDisplay(): void {
        const value = parseInt(this.historySlider.value);
        if (value === -1) {
            this.historyValue.textContent = 'Unlimited';
        } else if (value === 0) {
            this.historyValue.textContent = 'None';
        } else {
            this.historyValue.textContent = `${value} messages`;
        }
    }

    // ✨ 新增：更新预设按钮状态
    private updatePresetButtons(): void {
        const value = parseInt(this.historySlider.value);
        this.container.querySelectorAll('.llm-input__preset-btn').forEach(btn => {
            const btnValue = parseInt((btn as HTMLElement).dataset.history || '-1');
            btn.classList.toggle('active', btnValue === value);
        });
    }

    // ✨ 新增：更新活动设置徽章
    private updateActiveBadges(): void {
        const activeSettingsContainer = this.container.querySelector('.llm-input__active-settings') as HTMLElement;
        const modelBadge = this.container.querySelector('.llm-input__active-badge[data-type="model"]') as HTMLElement;
        const historyBadge = this.container.querySelector('.llm-input__active-badge[data-type="history"]') as HTMLElement;
        
        let hasActiveSettings = false;
        
        // Model badge
        if (this.currentSettings.modelId) {
            const model = this.models.find(m => m.id === this.currentSettings.modelId);
            const modelText = modelBadge.querySelector('.llm-input__badge-text');
            if (modelText) {
                modelText.textContent = model?.name || this.currentSettings.modelId;
            }
            modelBadge.style.display = 'inline-flex';
            hasActiveSettings = true;
        } else {
            modelBadge.style.display = 'none';
        }
        
        // History badge (只在非默认值时显示)
        if (this.currentSettings.historyLength !== -1) {
            const historyText = historyBadge.querySelector('.llm-input__badge-text');
            if (historyText) {
                historyText.textContent = this.currentSettings.historyLength === 0 
                    ? 'No history' 
                    : `${this.currentSettings.historyLength} msgs`;
            }
            historyBadge.style.display = 'inline-flex';
            hasActiveSettings = true;
        } else {
            historyBadge.style.display = 'none';
        }
        
        activeSettingsContainer.style.display = hasActiveSettings ? 'flex' : 'none';
        
        // 更新设置按钮指示器
        this.settingsBtn.classList.toggle('has-overrides', hasActiveSettings);
    }

    // ✨ 新增：通知设置变化
    private notifySettingsChange(): void {
        this.options.onSettingsChange?.(this.currentSettings);
        this.options.onInputChange?.();
    }

    // ✨ 新增：更新模型选项
    public updateModels(models: ModelOption[]): void {
        this.models = models;
        this.updateModelOptions();
    }

    private updateModelOptions(): void {
        // 按 provider 分组
        const groups: Record<string, ModelOption[]> = {};
        const ungrouped: ModelOption[] = [];
        
        this.models.forEach(model => {
            if (model.provider) {
                if (!groups[model.provider]) groups[model.provider] = [];
                groups[model.provider].push(model);
            } else {
                ungrouped.push(model);
            }
        });
        
        let html = '<option value="">Use Agent Default</option>';
        
        // 未分组模型
        ungrouped.forEach(model => {
            html += `<option value="${model.id}">${model.name}</option>`;
        });
        
        // 分组模型
        Object.entries(groups).forEach(([provider, models]) => {
            html += `<optgroup label="${provider}">`;
            models.forEach(model => {
                html += `<option value="${model.id}">${model.name}</option>`;
            });
            html += `</optgroup>`;
        });
        
        this.modelSelect.innerHTML = html;
        
        // 恢复选中状态
        if (this.currentSettings.modelId) {
            this.modelSelect.value = this.currentSettings.modelId;
        }
    }
    private handlePaste(e: ClipboardEvent) {
        // 如果正在加载中，不允许粘贴文件（可选）
        if (this.loading) return;

        const items = e.clipboardData?.items;
        if (!items) return;

        const pastedFiles: File[] = [];

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.kind === 'file') {
                const file = item.getAsFile();
                if (file) {
                    // 如果是截图，通常文件名是 image.png，容易重名覆盖
                    // 我们可以给它重命名
                    const finalFile = this.renameFileIfNeeded(file);
                    pastedFiles.push(finalFile);
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

    /**
     * ✨ 绑定拖拽事件
     */
    private bindDragEvents() {
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

    /**
     * 更新执行器列表，支持分组
     */
    public updateExecutors(executors: ExecutorOption[], activeId?: string) {
        //this.executors = executors;
        
        // 分组逻辑
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

    private addFiles(newFiles: File[]) {
        this.files = [...this.files, ...newFiles];
        this.renderAttachments();
    }

    private removeFile(index: number) {
        this.files.splice(index, 1);
        this.renderAttachments();
    }

    private renderAttachments() {
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

    private async triggerSend() {
        const text = this.textarea.value.trim();
        if ((!text && this.files.length === 0) || this.loading) return;

        const currentExecutor = this.executorSelect.value;
        const currentFiles = [...this.files];
        
        // ✨ 构建覆盖参数
        const overrides: ChatOverrides = {};
        if (this.currentSettings.modelId) {
            overrides.modelId = this.currentSettings.modelId;
        }
        if (this.currentSettings.historyLength !== -1) {
            overrides.historyLength = this.currentSettings.historyLength;
        }

        // Reset UI
        this.textarea.value = '';
        this.textarea.style.height = 'auto';
        this.files = [];
        this.renderAttachments();
        
        // ✨ 传递 overrides
        await this.options.onSend(text, currentFiles, currentExecutor, overrides);
    }

    setLoading(loading: boolean) {
        this.loading = loading;
        this.sendBtn.style.display = loading ? 'none' : 'flex';
        this.stopBtn.style.display = loading ? 'flex' : 'none';
        this.textarea.disabled = loading;
        this.executorSelect.disabled = loading;
        this.attachBtn.disabled = loading;
        this.settingsBtn.disabled = loading;
        
        // 禁用/启用拖拽样式
        if (loading) {
            this.inputWrapper.classList.add('llm-input__field-wrapper--disabled');
            this.toggleSettings(false); // 发送时关闭设置面板
        } else {
            this.inputWrapper.classList.remove('llm-input__field-wrapper--disabled');
        }
    }

    focus() {
        this.textarea?.focus();
    }

    // ✨ [新增] 销毁方法
    destroy() {
        this.container.innerHTML = '';
        this.files = [];
    }

    // ✨ [新增] 获取当前选中的执行器
    public getSelectedExecutor(): string {
        return this.executorSelect?.value || 'default';
    }

    // ✨ [新增] 设置输入内容
    setInput(text: string) {
        if (this.textarea) {
            this.textarea.value = text;
            // 触发高度调整
            this.textarea.dispatchEvent(new Event('input'));
        }
    }

    // ✨ 新增：尝试设置选中的执行器，如果不存在则回退到 default
    public setExecutor(id: string): void {
        if (!this.executorSelect) return;
        
        const option = this.executorSelect.querySelector(`option[value="${id}"]`);
        if (option) {
            this.executorSelect.value = id;
        } else {
            console.warn(`[ChatInput] Agent ${id} not found, falling back to default.`);
            this.executorSelect.value = 'default';
        }
    }

    // ✨ 新增：获取当前状态（文本和 Agent ID）
    // 注意：暂不持久化未上传的文件，因为 File 对象无法简单序列化到 JSON
    public getState(): ChatInputState {
        return {
            text: this.textarea?.value || '',
            agentId: this.getSelectedExecutor(),
            settings: { ...this.currentSettings }
        };
    }

    public setState(state: Partial<ChatInputState>): void {
        if (state.text !== undefined && this.textarea) {
            this.textarea.value = state.text;
            // 触发高度调整
            this.textarea.dispatchEvent(new Event('input', { bubbles: false }));
            // 注意：这里不触发 onInputChange，避免循环保存
        }
        if (state.agentId) {
            this.setExecutor(state.agentId);
        }
        if (state.settings) {
            this.currentSettings = { ...this.currentSettings, ...state.settings };
            if (this.currentSettings.modelId) {
                this.modelSelect.value = this.currentSettings.modelId;
            }
            this.historySlider.value = this.currentSettings.historyLength.toString();
            this.updateHistoryDisplay();
            this.updatePresetButtons();
            this.updateActiveBadges();
        }
    }

    // ✨ 新增：获取当前设置
    public getSettings(): ChatSettings {
        return { ...this.currentSettings };
    }

    // ✨ 新增：设置当前设置
    public setSettings(settings: Partial<ChatSettings>): void {
        this.currentSettings = { ...this.currentSettings, ...settings };
        
        if (settings.modelId !== undefined) {
            this.modelSelect.value = settings.modelId || '';
        }
        if (settings.historyLength !== undefined) {
            this.historySlider.value = settings.historyLength.toString();
            this.updateHistoryDisplay();
            this.updatePresetButtons();
        }
        
        this.updateActiveBadges();
    }

    // ✨ 新增：重置设置到默认值
    public resetSettings(): void {
        this.currentSettings = {
            modelId: undefined,
            historyLength: -1,
            temperature: undefined
        };
        this.modelSelect.value = '';
        this.historySlider.value = '-1';
        this.updateHistoryDisplay();
        this.updatePresetButtons();
        this.updateActiveBadges();
        this.notifySettingsChange();
    }
}
