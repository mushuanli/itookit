// @file llm-ui/components/ChatInput.ts

// @file: llm-ui/components/ChatInput.ts

import { ChatInputTemplates } from './templates/ChatInputTemplates';

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
    streamMode?: boolean;
}

// 默认设置
export const DEFAULT_SESSION_SETTINGS: ChatSessionSettings = {
    modelId: undefined,
    historyLength: -1,
    temperature: undefined,
    streamMode: true,
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
    private streamToggle!: HTMLInputElement;
    private settingsPanel!: HTMLElement;
    private fileInput!: HTMLInputElement;
    private attachmentContainer!: HTMLElement;
    private inputWrapper!: HTMLElement;

    // === 外部点击监听器引用（用于清理） ===
    private outsideClickHandler: ((e: MouseEvent) => void) | null = null;

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

    // ================================================================
    // 初始化
    // ================================================================

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
        const agents = this.options.initialAgents?.length
            ? this.options.initialAgents
            : [{ id: 'default', name: 'Assistant', category: 'System' }];
        this.updateExecutors(agents);
    }

    private render(): void {
        this.container.innerHTML = ChatInputTemplates.renderMain();
        this.bindElements();
        this.updateModelOptions();
        this.updateHistoryDisplay();
    }

    private bindElements(): void {
        const q = <T extends HTMLElement>(sel: string): T =>
            this.container.querySelector(sel) as T;

        this.textarea = q('.llm-input__textarea');
        this.sendBtn = q('.llm-input__btn--send');
        this.stopBtn = q('.llm-input__btn--stop');
        this.attachBtn = q('.llm-input__btn--attach');
        this.settingsBtn = q('.llm-input__btn--settings');
        this.executorSelect = q('.llm-input__executor-select');
        this.modelSelect = q('.llm-input__model-select');
        this.historySlider = q('.llm-input__history-slider');
        this.historyValue = q('.llm-input__history-value');
        this.streamToggle = q('.llm-input__stream-toggle');
        this.settingsPanel = q('.llm-input__settings-panel');
        this.fileInput = q('.llm-input__file-input');
        this.attachmentContainer = q('.llm-input__attachments');
        this.inputWrapper = q('.llm-input__field-wrapper');
    }

    // ================================================================
    // 事件绑定
    // ================================================================

    private bindEvents(): void {
        this.bindTextareaEvents();
        this.bindButtonEvents();
        this.bindSettingsEvents();
        this.bindDragEvents();
        this.bindOutsideClickHandler();
    }

    private bindTextareaEvents(): void {
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

        this.textarea.addEventListener('paste', (e) => this.handlePaste(e));
    }

    private bindButtonEvents(): void {
        this.sendBtn.addEventListener('click', () => this.triggerSend());
        this.stopBtn.addEventListener('click', () => this.options.onStop());
        this.attachBtn.addEventListener('click', () => this.fileInput.click());
        this.settingsBtn.addEventListener('click', () => this.toggleSettings());

        this.container.querySelector('.llm-input__settings-close')
            ?.addEventListener('click', () => this.toggleSettings(false));

        this.fileInput.addEventListener('change', () => {
            if (this.fileInput.files) {
                this.addFiles(Array.from(this.fileInput.files));
                this.fileInput.value = '';
            }
        });
    }

    private bindSettingsEvents(): void {
        // Agent 选择
        this.executorSelect.addEventListener('change', async () => {
            const newAgentId = this.executorSelect.value;
            this.config.agentId = newAgentId;

            if (newAgentId !== this.currentAgentId) {
                this.currentAgentId = newAgentId;
                this.config.settings.modelId = undefined;
                this.modelSelect.value = '';
                await this.loadModelsForAgent(newAgentId);
            }

            this.options.onExecutorChange?.(newAgentId);
            this.notifyConfigChange();
        });

        // Model 选择
        this.modelSelect.addEventListener('change', () => {
            this.config.settings.modelId = this.modelSelect.value || undefined;
            this.updateActiveBadges();
            this.notifyConfigChange();
        });

        // History slider
        this.historySlider.addEventListener('input', () => {
            this.config.settings.historyLength = parseInt(this.historySlider.value);
            this.updateHistoryDisplay();
            this.updatePresetButtons();
            this.updateActiveBadges();
        });

        this.historySlider.addEventListener('change', () => {
            this.notifyConfigChange();
        });

        // Stream toggle
        this.streamToggle.addEventListener('change', () => {
            this.config.settings.streamMode = this.streamToggle.checked;
            this.updateStreamToggleLabel();
            this.updateActiveBadges();
            this.notifyConfigChange();
        });

        // Preset 按钮
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

        // Badge 清除按钮
        this.container.querySelectorAll('.llm-input__badge-clear').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const clearType = (e.currentTarget as HTMLElement).dataset.clear;
                this.clearSetting(clearType as 'model' | 'history' | 'stream');
            });
        });
    }

    private bindOutsideClickHandler(): void {
        this.outsideClickHandler = (e: MouseEvent) => {
            if (this.settingsExpanded) {
                const target = e.target as HTMLElement;
                if (!this.settingsPanel.contains(target) && !this.settingsBtn.contains(target)) {
                    this.toggleSettings(false);
                }
            }
        };
        document.addEventListener('click', this.outsideClickHandler);
    }

    // ================================================================
    // 模型加载
    // ================================================================

    private async loadModelsForAgent(agentId: string): Promise<void> {
        if (!this.options.onRequestModels || this.isLoadingModels) return;

        this.isLoadingModels = true;
        this.setModelSelectLoading(true);

        try {
            const models = await this.options.onRequestModels(agentId);
            this.models = models;
            this.updateModelOptions();

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

    private setModelSelectLoading(loading: boolean): void {
        if (!this.modelSelect) return;
        this.modelSelect.disabled = loading;
        if (loading) {
            this.modelSelect.innerHTML = '<option value="">Loading models...</option>';
        }
    }

    // ================================================================
    // UI 同步
    // ================================================================

    private syncUIFromConfig(): void {
        if (this.textarea) {
            this.textarea.value = this.config.text;
            this.adjustTextareaHeight();
        }

        if (this.executorSelect) {
            this.setExecutorValue(this.config.agentId);
        }

        if (this.modelSelect && this.config.settings.modelId) {
            this.modelSelect.value = this.config.settings.modelId;
        }

        if (this.historySlider) {
            this.historySlider.value = this.config.settings.historyLength.toString();
            this.updateHistoryDisplay();
            this.updatePresetButtons();
        }

        if (this.streamToggle) {
            this.streamToggle.checked = this.config.settings.streamMode;
            this.updateStreamToggleLabel();
        }

        this.updateActiveBadges();
    }

    private syncConfigFromUI(): void {
        this.config.text = this.textarea?.value || '';
        this.config.agentId = this.executorSelect?.value || 'default';
        this.config.settings.modelId = this.modelSelect?.value || undefined;
        this.config.settings.historyLength = parseInt(this.historySlider?.value || '-1');
        this.config.settings.streamMode = this.streamToggle?.checked ?? true;
    }

    // ================================================================
    // 设置面板
    // ================================================================

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

    private updateStreamToggleLabel(): void {
        const label = this.container.querySelector('.llm-input__toggle-label');
        if (label) {
            label.textContent = this.config.settings.streamMode ? 'Enabled' : 'Disabled';
        }
    }

    private toggleSettings(show?: boolean): void {
        this.settingsExpanded = show ?? !this.settingsExpanded;
        this.settingsPanel.style.display = this.settingsExpanded ? 'block' : 'none';
        this.settingsBtn.classList.toggle('active', this.settingsExpanded);

        if (this.settingsExpanded) {
            this.settingsPanel.classList.add('llm-input__settings-panel--entering');
            requestAnimationFrame(() => {
                this.settingsPanel.classList.remove('llm-input__settings-panel--entering');
            });
        }
    }

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

    private updatePresetButtons(): void {
        const value = this.config.settings.historyLength;
        this.container.querySelectorAll('.llm-input__preset-btn').forEach(btn => {
            const btnValue = parseInt((btn as HTMLElement).dataset.history || '-1');
            btn.classList.toggle('active', btnValue === value);
        });
    }

    private updateActiveBadges(): void {
        const activeContainer = this.container.querySelector('.llm-input__active-settings') as HTMLElement;
        const modelBadge = this.container.querySelector('.llm-input__active-badge[data-type="model"]') as HTMLElement;
        const streamBadge = this.container.querySelector('.llm-input__active-badge[data-type="stream"]') as HTMLElement;
        const historyBadge = this.container.querySelector('.llm-input__active-badge[data-type="history"]') as HTMLElement;

        if (!activeContainer) return;

        let hasActiveSettings = false;

        // Model badge
        if (this.config.settings.modelId) {
            const model = this.models.find(m => m.id === this.config.settings.modelId);
            const text = modelBadge?.querySelector('.llm-input__badge-text');
            if (text) text.textContent = model?.name || this.config.settings.modelId;
            if (modelBadge) modelBadge.style.display = 'inline-flex';
            hasActiveSettings = true;
        } else if (modelBadge) {
            modelBadge.style.display = 'none';
        }

        // Stream badge (只在关闭时显示)
        if (!this.config.settings.streamMode) {
            if (streamBadge) streamBadge.style.display = 'inline-flex';
            hasActiveSettings = true;
        } else if (streamBadge) {
            streamBadge.style.display = 'none';
        }

        // History badge
        if (this.config.settings.historyLength !== -1) {
            const text = historyBadge?.querySelector('.llm-input__badge-text');
            if (text) {
                text.textContent = this.config.settings.historyLength === 0
                    ? 'No history'
                    : `${this.config.settings.historyLength} msgs`;
            }
            if (historyBadge) historyBadge.style.display = 'inline-flex';
            hasActiveSettings = true;
        } else if (historyBadge) {
            historyBadge.style.display = 'none';
        }

        activeContainer.style.display = hasActiveSettings ? 'flex' : 'none';
        this.settingsBtn.classList.toggle('has-overrides', hasActiveSettings);
    }

    private notifyConfigChange(): void {
        this.options.onConfigChange?.(this.getConfig());
    }

    // ================================================================
    // 发送
    // ================================================================

    private adjustTextareaHeight(): void {
        this.textarea.style.height = 'auto';
        const newHeight = Math.min(this.textarea.scrollHeight, 200);
        this.textarea.style.height = `${newHeight}px`;
    }

    private async triggerSend(): Promise<void> {
        const text = this.textarea.value.trim();
        if ((!text && this.files.length === 0) || this.loading) return;

        const currentExecutor = this.config.agentId;
        const currentFiles = [...this.files];

        // 构建覆盖参数
        const overrides = this.buildOverrides();

        // 清空 UI（发送成功后保持清空，失败时由 restoreInput 恢复）
        this.textarea.value = '';
        this.textarea.style.height = 'auto';
        this.config.text = '';
        this.files = [];
        this.renderAttachments();

        await this.options.onSend(text, currentFiles, currentExecutor, overrides);
    }

    /**
     * 从当前设置构建覆盖参数
     */
    private buildOverrides(): ChatOverrides {
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
        if (!this.config.settings.streamMode) {
            overrides.streamMode = false;
        }

        return overrides;
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
            this.addFiles(pastedFiles);
        }
    }

    private bindDragEvents(): void {
        const wrapper = this.inputWrapper;

        wrapper.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (!this.loading) {
                wrapper.classList.add('llm-input__field-wrapper--drag-active');
            }
        });

        wrapper.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            wrapper.classList.remove('llm-input__field-wrapper--drag-active');
        });

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

    /**
     * ✅ 使用模板渲染附件
     */
    private renderAttachments(): void {
        if (this.files.length === 0) {
            this.attachmentContainer.style.display = 'none';
            return;
        }

        this.attachmentContainer.style.display = 'flex';
        this.attachmentContainer.innerHTML = ChatInputTemplates.renderAttachments(this.files);

        this.attachmentContainer.querySelectorAll('.llm-input__remove-btn').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const idx = parseInt((e.target as HTMLElement).dataset.index!);
                this.removeFile(idx);
            });
        });
    }

    // ================================================================
    // 模型与执行器管理
    // ================================================================

    /**
     * ✅ 使用模板渲染模型选项
     */
    private updateModelOptions(): void {
        this.modelSelect.innerHTML = ChatInputTemplates.renderModelOptions(
            this.models,
            this.config.settings.modelId
        );
    }

    public updateModels(models: ModelOption[]): void {
        const previousModelId = this.config.settings.modelId;
        this.models = models;
        this.updateModelOptions();

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

    /**
     * ✅ 使用模板渲染执行器选项
     */
    public updateExecutors(executors: ExecutorOption[], activeId?: string): void {
        this.executorSelect.innerHTML = ChatInputTemplates.renderExecutorOptions(executors);

        if (activeId) {
            this.setExecutor(activeId);
        }
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

        if (config.agentId && config.agentId !== this.currentAgentId) {
            this.currentAgentId = config.agentId;
            this.loadModelsForAgent(config.agentId);
        }
    }

    /**
     * ✅ 修复问题1：恢复输入内容
     * 
     * 当发送失败时调用此方法，将之前的输入内容恢复到输入框中，
     * 避免用户丢失已输入的内容。
     * 
     * @param text 要恢复的文本内容
     * @param agentId 要恢复的 agent ID（可选）
     */
    public restoreInput(text: string, agentId?: string): void {
        // 恢复文本
        if (text) {
            this.config.text = text;
            this.textarea.value = text;
            this.adjustTextareaHeight();
        }

        // 恢复 agent 选择
        if (agentId) {
            this.config.agentId = agentId;
            this.setExecutorValue(agentId);
        }

        // 聚焦输入框，将光标移到末尾
        this.textarea.focus();
        this.textarea.selectionStart = this.textarea.selectionEnd = this.textarea.value.length;
    }

    /**
     * 强制刷新模型列表
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
        // ✅ 清理外部点击
        if (this.outsideClickHandler) {
            document.removeEventListener('click', this.outsideClickHandler);
            this.outsideClickHandler = null;
        }

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
