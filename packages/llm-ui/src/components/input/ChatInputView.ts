// @file: llm-ui/components/input/ChatInputView.ts

import type { IChatInputPresenter, IChatInputConfig } from '../../domain/ports/IChatInputPresenter';
import type {
    ExecutorOption, ModelOption,
    ChatOverrides,
} from '../../domain/types';
import { ChatInputTemplates } from '../templates/ChatInputTemplates';
import type { InputPlugin, InputPluginContext } from './plugins/InputPlugin';

export interface ChatInputOptions {
    onSend: (text: string, files: File[], executorId: string, overrides?: ChatOverrides) => Promise<void>;
    onStop: () => void;
    onExecutorChange?: (executorId: string) => void;
    onConfigChange?: (config: IChatInputConfig) => void;
    initialAgents?: ExecutorOption[];
    initialConfig?: Partial<IChatInputConfig>;
    onRequestModels?: (agentId: string) => Promise<ModelOption[]>;
}

/**
 * ChatInput — 实现 IChatInputPresenter
 *
 * Shell 只通过 IChatInputPresenter 交互。
 * 内部 DOM 操作完全封装。
 */
export class ChatInput implements IChatInputPresenter {
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

    private outsideClickHandler: ((e: MouseEvent) => void) | null = null;
    private loading = false;
    private files: File[] = [];
    private settingsExpanded = false;
    private models: ModelOption[] = [];
    private currentAgentId: string = 'default';
    private isLoadingModels: boolean = false;

    // ✨ 新增：插件系统
    private plugins: InputPlugin[] = [];
    private pluginCtx: InputPluginContext | null = null;

    private config: IChatInputConfig = {
        text: '',
        agentId: 'default',
        settings: { historyLength: -1, streamMode: true },
    };

    constructor(private container: HTMLElement, private options: ChatInputOptions) {
        if (options.initialConfig) {
            this.config = this.mergeConfig(this.config, options.initialConfig);
        }
        this.currentAgentId = this.config.agentId;

        this.render();
        this.bindEvents();
        this.initExecutors();
        this.syncUIFromConfig();
        this.loadModelsForAgent(this.currentAgentId);
    }

    /**
     * 注册插件（init 后、bindEvents 后调用）
     */
    registerPlugin(plugin: InputPlugin): void {
        console.log(`[ChatInput] registerPlugin: ${plugin.id}, priority: ${plugin.priority ?? 100}`);

        this.plugins.push(plugin);
        this.plugins.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

        if (this.pluginCtx) {
            console.log(`[ChatInput] Activating plugin: ${plugin.id}`);
            plugin.activate(this.pluginCtx);
        } else {
            console.warn(`[ChatInput] Plugin "${plugin.id}" registered but pluginCtx not ready yet`);
        }
    }

    /**
     * 在 bindEvents 中调用，构建 Plugin 上下文
     */
    private initPluginSystem(): void {
        console.log('[ChatInput] initPluginSystem called');

        this.pluginCtx = {
            textarea: this.textarea,
            container: this.container,
            getText: () => this.textarea.value,
            setText: (text) => {
                this.textarea.value = text;
                this.config.text = text;
                this.adjustTextareaHeight();
            },
            insertAtCursor: (text) => {
                const pos = this.textarea.selectionStart;
                const before = this.textarea.value.slice(0, pos);
                const after = this.textarea.value.slice(pos);
                this.pluginCtx!.setText(before + text + after);
                this.textarea.selectionStart = this.textarea.selectionEnd = pos + text.length;
            },
            replaceRange: (start, end, text) => {
                const val = this.textarea.value;
                this.pluginCtx!.setText(val.slice(0, start) + text + val.slice(end));
                this.textarea.selectionStart = this.textarea.selectionEnd = start + text.length;
            },
            getCursorPosition: () => this.textarea.selectionStart,
            setCursorPosition: (pos) => {
                this.textarea.selectionStart = this.textarea.selectionEnd = pos;
            },
            triggerSend: () => this.triggerSend(),
            focus: () => this.textarea.focus(),
            getAgentId: () => this.config.agentId,
        };

        console.log(`[ChatInput] pluginCtx ready, activating ${this.plugins.length} pending plugin(s)`);

        // 激活已注册但未激活的插件
        for (const plugin of this.plugins) {
            console.log(`[ChatInput] Late-activating plugin: ${plugin.id}`);
            plugin.activate(this.pluginCtx);
        }
    }

    // ================================================================
    // IChatInputPresenter 实现
    // ================================================================

    setLoading(loading: boolean): void {
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

    setConfig(config: Partial<IChatInputConfig>): void {
        this.config = this.mergeConfig(this.config, config);
        this.syncUIFromConfig();

        if (config.agentId && config.agentId !== this.currentAgentId) {
            this.currentAgentId = config.agentId;
            this.loadModelsForAgent(config.agentId);
        }
    }

    getConfig(): IChatInputConfig {
        this.syncConfigFromUI();
        return {
            text: this.config.text,
            agentId: this.config.agentId,
            settings: { ...this.config.settings },
        };
    }

    restoreInput(text: string, agentId?: string): void {
        if (text) {
            this.config.text = text;
            this.textarea.value = text;
            this.adjustTextareaHeight();
        }
        if (agentId) {
            this.config.agentId = agentId;
            this.setExecutorValue(agentId);
        }
        this.textarea.focus();
        this.textarea.selectionStart = this.textarea.selectionEnd = this.textarea.value.length;
    }

    focus(): void {
        this.textarea?.focus();
    }

    refreshAgents(
        agents: ExecutorOption[],
        validateAgentId: (id: string, agents: ExecutorOption[]) => string
    ): boolean {
        const currentAgentId = this.config.agentId;
        this.updateExecutors(agents);

        const validatedId = validateAgentId(currentAgentId, agents);
        const changed = validatedId !== currentAgentId;

        if (changed) {
            this.config.agentId = validatedId;
            this.currentAgentId = validatedId;
            this.setExecutorValue(validatedId);
            this.config.settings.modelId = undefined;
            this.modelSelect.value = '';
            this.updateActiveBadges();
        }

        this.loadModelsForAgent(this.currentAgentId);
        return changed;
    }

    destroy(): void {
        if (this.outsideClickHandler) {
            document.removeEventListener('click', this.outsideClickHandler);
            this.outsideClickHandler = null;
        }
        this.container.innerHTML = '';
        this.files = [];
    }

    // ================================================================
    // 内部实现（与原始代码一致，省略重复部分）
    // ================================================================

    private mergeConfig(base: IChatInputConfig, partial: Partial<IChatInputConfig>): IChatInputConfig {
        return {
            text: partial.text ?? base.text,
            agentId: partial.agentId ?? base.agentId,
            settings: { ...base.settings, ...(partial.settings || {}) },
        };
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

    private bindEvents(): void {
        this.textarea.addEventListener('input', () => {
            this.adjustTextareaHeight();
            this.config.text = this.textarea.value;
            this.notifyConfigChange();

            // ✨ 通知所有插件
            const cursorPos = this.textarea.selectionStart;
            console.debug(`[ChatInput] input event, plugins: ${this.plugins.length}, text: "${this.textarea.value.slice(0, 20)}..."`);

            for (const plugin of this.plugins) {
                plugin.onInput?.(this.textarea.value, cursorPos);
            }
        });

        this.textarea.addEventListener('keydown', (e) => {
            // ✨ Plugin 链式处理
            console.debug(`[ChatInput] keydown: ${e.key}, plugins: ${this.plugins.length}`);

            for (const plugin of this.plugins) {
                if (plugin.onKeyDown?.(e)) {
                    console.debug(`[ChatInput] Key "${e.key}" consumed by plugin: ${plugin.id}`);
                    return;
                }
            }

            // 默认行为
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.triggerSend();
            }
        });

        this.textarea.addEventListener('paste', (e) => this.handlePaste(e));

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

        this.bindSettingsEvents();
        this.bindDragEvents();
        this.bindOutsideClickHandler();

        // ✅ 初始化插件系统（放在所有事件绑定之后）
        this.initPluginSystem();
    }

    private bindSettingsEvents(): void {
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

        this.streamToggle.addEventListener('change', () => {
            this.config.settings.streamMode = this.streamToggle.checked;
            this.updateStreamToggleLabel();
            this.updateActiveBadges();
            this.notifyConfigChange();
        });

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

    // ================================================================
    // 发送
    // ================================================================

    private async triggerSend(): Promise<void> {
        const text = this.textarea.value.trim();
        if ((!text && this.files.length === 0) || this.loading) return;

        // ✨ before 钩子
        for (const plugin of this.plugins) {
            if (plugin.onBeforeSend?.(text) === false) return;
        }

        const currentExecutor = this.config.agentId;
        const currentFiles = [...this.files];
        const overrides = this.buildOverrides();

        this.textarea.value = '';
        this.textarea.style.height = 'auto';
        this.config.text = '';
        this.files = [];
        this.renderAttachments();

        await this.options.onSend(text, currentFiles, currentExecutor, overrides);

        // ✨ after 钩子
        for (const plugin of this.plugins) {
            plugin.onAfterSend?.(text, currentExecutor);
        }
    }

    private buildOverrides(): ChatOverrides {
        const overrides: ChatOverrides = {};
        if (this.config.settings.modelId) overrides.modelId = this.config.settings.modelId;
        if (this.config.settings.historyLength !== -1) overrides.historyLength = this.config.settings.historyLength;
        if (this.config.settings.temperature !== undefined) overrides.temperature = this.config.settings.temperature;
        if (!this.config.settings.streamMode) overrides.streamMode = false;
        return overrides;
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
        if (this.executorSelect) this.setExecutorValue(this.config.agentId);
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

    private adjustTextareaHeight(): void {
        this.textarea.style.height = 'auto';
        const newHeight = Math.min(this.textarea.scrollHeight, 200);
        this.textarea.style.height = `${newHeight}px`;
    }

    // ================================================================
    // 设置面板
    // ================================================================

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

    private updateHistoryDisplay(): void {
        const value = this.config.settings.historyLength;
        if (value === -1) this.historyValue.textContent = 'Unlimited';
        else if (value === 0) this.historyValue.textContent = 'None';
        else this.historyValue.textContent = `${value} messages`;
    }

    private updatePresetButtons(): void {
        const value = this.config.settings.historyLength;
        this.container.querySelectorAll('.llm-input__preset-btn').forEach(btn => {
            const btnValue = parseInt((btn as HTMLElement).dataset.history || '-1');
            btn.classList.toggle('active', btnValue === value);
        });
    }

    private updateStreamToggleLabel(): void {
        const label = this.container.querySelector('.llm-input__toggle-label');
        if (label) label.textContent = this.config.settings.streamMode ? 'Enabled' : 'Disabled';
    }

    private updateActiveBadges(): void {
        const activeContainer = this.container.querySelector('.llm-input__active-settings') as HTMLElement;
        const modelBadge = this.container.querySelector('.llm-input__active-badge[data-type="model"]') as HTMLElement;
        const streamBadge = this.container.querySelector('.llm-input__active-badge[data-type="stream"]') as HTMLElement;
        const historyBadge = this.container.querySelector('.llm-input__active-badge[data-type="history"]') as HTMLElement;

        if (!activeContainer) return;
        let hasActive = false;

        if (this.config.settings.modelId) {
            const model = this.models.find(m => m.id === this.config.settings.modelId);
            const text = modelBadge?.querySelector('.llm-input__badge-text');
            if (text) text.textContent = model?.name || this.config.settings.modelId;
            if (modelBadge) modelBadge.style.display = 'inline-flex';
            hasActive = true;
        } else if (modelBadge) { modelBadge.style.display = 'none'; }

        if (!this.config.settings.streamMode) {
            if (streamBadge) streamBadge.style.display = 'inline-flex';
            hasActive = true;
        } else if (streamBadge) { streamBadge.style.display = 'none'; }

        if (this.config.settings.historyLength !== -1) {
            const text = historyBadge?.querySelector('.llm-input__badge-text');
            if (text) {
                text.textContent = this.config.settings.historyLength === 0
                    ? 'No history' : `${this.config.settings.historyLength} msgs`;
            }
            if (historyBadge) historyBadge.style.display = 'inline-flex';
            hasActive = true;
        } else if (historyBadge) { historyBadge.style.display = 'none'; }

        activeContainer.style.display = hasActive ? 'flex' : 'none';
        this.settingsBtn.classList.toggle('has-overrides', hasActive);
    }

    private notifyConfigChange(): void {
        this.options.onConfigChange?.(this.getConfig());
    }

    // ================================================================
    // 附件
    // ================================================================

    private handlePaste(e: ClipboardEvent): void {
        if (this.loading) return;
        const items = e.clipboardData?.items;
        if (!items) return;

        const pastedFiles: File[] = [];
        for (let i = 0; i < items.length; i++) {
            if (items[i].kind === 'file') {
                const file = items[i].getAsFile();
                if (file) pastedFiles.push(this.renameFileIfNeeded(file));
            }
        }
        if (pastedFiles.length > 0) this.addFiles(pastedFiles);
    }

    private renameFileIfNeeded(file: File): File {
        if (file.name === 'image.png' || file.name === 'image.jpg') {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            return new File([file], `paste_${timestamp}.${file.name.split('.').pop()}`, { type: file.type });
        }
        return file;
    }

    private addFiles(newFiles: File[]): void {
        this.files = [...this.files, ...newFiles];
        this.renderAttachments();
    }

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
                this.files.splice(idx, 1);
                this.renderAttachments();
            });
        });
    }

    // ================================================================
    // 执行器/模型 UI
    // ================================================================

    private initExecutors(): void {
        const agents = this.options.initialAgents?.length
            ? this.options.initialAgents
            : [{ id: 'default', name: 'Assistant', category: 'System' }];
        this.updateExecutors(agents);
    }

    private updateExecutors(executors: ExecutorOption[]): void {
        this.executorSelect.innerHTML = ChatInputTemplates.renderExecutorOptions(executors);
    }

    private updateModelOptions(): void {
        this.modelSelect.innerHTML = ChatInputTemplates.renderModelOptions(
            this.models, this.config.settings.modelId
        );
    }

    private setExecutorValue(id: string): void {
        const option = this.executorSelect.querySelector(`option[value="${id}"]`);
        this.executorSelect.value = option ? id : 'default';
    }
}
