// @file: llm-ui/components/input/ChatInputView.ts

import type { IChatInputPresenter, IChatInputConfig } from '../../domain/ports/IChatInputPresenter';
import type {
    ExecutorOption, ConnectionOption,
    ChatOverrides, SkillInfo, FileSuggestion,
} from '../../domain/types';
import type { JsonValue, ModelTier } from '@itookit/common';
import { ChatInputTemplates } from '../templates/ChatInputTemplates';
import type { InputPlugin, InputPluginContext } from './plugins/InputPlugin';
import { MentionPlugin } from './plugins/MentionPlugin';
import { TokenMeterPlugin } from './plugins/TokenMeterPlugin';
import { PopupPanel } from './plugins/PopupPanel';
import type { PopupItem } from './plugins/PopupPanel';
import { AttachmentManager } from './AttachmentManager';
import { ToolOutputPanel } from './ToolOutputPanel';
import { HelpPanel } from './HelpPanel';
import { SkillPanel } from './SkillPanel';
import { ConnectionTierController } from './ConnectionTierController';
import { delegate } from '../../utils/domEvents';

export interface ChatInputOptions {
    onSend: (text: string, files: File[], executorId: string, overrides?: ChatOverrides) => Promise<void>;
    onStop: () => void;
    onExecutorChange?: (executorId: string) => void;
    onConfigChange?: (config: IChatInputConfig) => void;
    initialAgents?: ExecutorOption[];
    initialConfig?: Partial<IChatInputConfig>;
    /** 获取所有可用连接列表，供 Connection 覆盖下拉使用。 */
    onRequestConnections?: () => Promise<ConnectionOption[]>;

    // ── Kernel callbacks ────────────────────────────────────────────────────

    /**
     * 获取可用 Skill 列表（含 loaded 状态）。
     *
     * 仅在 kernel 模式可用时由 Shell 注入。
     * ChatInput 在设置面板打开时调用此函数刷新列表。
     */
    onRequestSkills?: () => Promise<SkillInfo[]>;

    /**
     * 加载 Skill 到当前 kernel 会话。
     *
     * 调用后 kernel 的 IToolService 会注册该 Skill 的工具，
     * system prompt 会追加 Skill 的使用指令。
     *
     * @returns 新加载的工具 ID 列表
     */
    onLoadSkill?: (skillId: string) => Promise<string[]>;

    /**
     * 卸载 Skill。
     */
    onUnloadSkill?: (skillId: string) => Promise<void>;

    /**
     * 获取当前可用 Skill 列表（含 loaded 状态）。
     *
     * 供 SlashCommandPlugin 动态生成 Skill 快捷命令，每次弹出面板时调用。
     */
    getSkills?: () => SkillInfo[];

    // ── @mention 文件引用 ─────────────────────────────────────────────────────

    /**
     * 用户键入 `@` 后，根据 query 返回文件建议列表。
     *
     * 由 Shell 注入：调用 sessionEngine.searchFiles(query) 或
     * 遍历当前模块 VFS 节点。未提供时 `@` 不触发文件选择器。
     *
     * 返回的 `path` 字段将以 Markdown 链接形式插入输入框，
     * 发送时由 AttachmentProcessor 自动解析并附加文件内容。
     */
    onRequestFiles?: (query: string) => Promise<FileSuggestion[]>;

    /**
     * 对图片做 OCR（图片转文字），返回 Markdown 文本。
     *
     * 由 Shell 注入：内部调用视觉连接（conn-volcengine-vision）做单次 LLM 调用。
     * 未提供时，图片附件 chip 不显示「提取文字」按钮（优雅降级）。
     */
    onOcrImage?: (image: Blob) => Promise<string>;

    /**
     * 预留（本期不接线）：语音转文字。
     * 实现后将复用 OcrReviewPanel 的审阅流程把转写文本插入输入框。
     */
    onTranscribeAudio?: (audio: Blob) => Promise<string>;

    /**
     * 导航到设置页（如点击连接 badge 跳转到具体连接的编辑页）。
     * resourceId: 'connections' | 'providers'
     * anchor:  连接时 'conn:<id>'，Provider 时 '<providerId>'
     */
    onNavigateSettings?: (target: { resourceId: string; anchor?: string }) => void;
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
    private webSearchQuickBtn!: HTMLButtonElement;
    private historySlider!: HTMLInputElement;
    private historyValue: HTMLSpanElement | null = null; // removed from new template
    private streamToggle!: HTMLInputElement;
    private settingsPanel!: HTMLElement;
    private flowIdInput!: HTMLInputElement;
    private branchModeSelect!: HTMLSelectElement;
    private retentionModeSelect!: HTMLSelectElement;
    private fileInput!: HTMLInputElement;
    private attachmentContainer!: HTMLElement;
    private inputWrapper!: HTMLElement;

    // ── Agent Picker (custom combobox, popup via PopupPanel) ─────────────────
    private agents: ExecutorOption[] = [];
    private agentPickerBtn!: HTMLButtonElement;
    private agentNameEl!: HTMLSpanElement;
    private agentMetaEl!: HTMLSpanElement;
    private agentIconEl!: HTMLSpanElement;
    private agentPopup: PopupPanel | null = null;

    // ── Prompt Picker (preset prompts dropdown, popup via PopupPanel) ────────
    private promptPickerWrapper!: HTMLElement;
    private promptPickerBtn!: HTMLButtonElement;
    private promptPopup: PopupPanel | null = null;

    private outsideClickHandler: ((e: MouseEvent) => void) | null = null;
    private loading = false;
    private files: File[] = [];
    private settingsExpanded = false;
    private currentAgentId: string = 'default';

    private skillPanel!: SkillPanel;
    private connectionTier!: ConnectionTierController;

    // ── Help panel ───────────────────────────────────────────────────────────
    private helpPanel!: HelpPanel;

    // ── More menu ─────────────────────────────────────────────────────────────
    private moreBtn!: HTMLButtonElement;
    private morePopup: PopupPanel | null = null;

    // ── Tool output panel ─────────────────────────────────────────────────────
    private toolOutput: ToolOutputPanel;

    // ── Session profile ───────────────────────────────────────────────────────
    private systemPromptAppendInput!: HTMLTextAreaElement;

    // ── Plugin system ────────────────────────────────────────────────────────
    private plugins: InputPlugin[] = [];
    private pluginCtx: InputPluginContext | null = null;
    private tokenMeterPlugin: TokenMeterPlugin | null = null;

    // ── Attachment manager ────────────────────────────────────────────────────
    private attachmentMgr!: AttachmentManager;

    private config: IChatInputConfig = {
        text: '',
        agentId: 'default',
        settings: {
            connectionId: undefined,
            modelTier: 'auto',
            historyLength: -1,
            streamMode: true,
            branchMode: 'continue',
            retentionMode: 'persistent',
        },
    };

    /** 上次已通知的 settings JSON — 内容不变则跳过保存 */
    private lastNotifiedSettings: string | null = null;

    constructor(private container: HTMLElement, private options: ChatInputOptions) {
        if (options.initialConfig) {
            this.config = this.mergeConfig(this.config, options.initialConfig);
        }
        this.currentAgentId = this.config.agentId;

        this.render();

        // 面板必须在 render()（写入模板 + bindElements）之后构造，DOM 才存在。
        this.toolOutput = new ToolOutputPanel(container, () => this.textarea?.focus());
        this.helpPanel = new HelpPanel(container, {
            hasFiles: () => !!this.options.onRequestFiles,
            onCloseSettings: () => this.toggleSettings(false),
        });
        this.skillPanel = new SkillPanel(container, {
            onRequestSkills: this.options.onRequestSkills,
            onLoadSkill: this.options.onLoadSkill,
            onUnloadSkill: this.options.onUnloadSkill,
        });
        this.connectionTier = new ConnectionTierController(container, {
            getAgents: () => this.agents,
            getAgentId: () => this.config.agentId,
            onNavigateSettings: (target) => this.options.onNavigateSettings?.(target),
            onChange: () => {
                this.config.settings.connectionId = this.connectionTier.getConnectionId();
                this.config.settings.modelTier = this.connectionTier.getModelTier();
                this.updateActiveBadges();
                this.notifyConfigChange();
            },
        });

        this.bindEvents();
        this.initExecutors();
        this.syncUIFromConfig();
        this.loadConnections();

        // TokenMeterPlugin — always registered, shows token stats after each response
        const tokenMeter = new TokenMeterPlugin();
        this.tokenMeterPlugin = tokenMeter;
        this.registerPlugin(tokenMeter);

        // Register MentionPlugin if file-request callback is available
        if (options.onRequestFiles) {
            this.registerPlugin(new MentionPlugin({ onRequestFiles: options.onRequestFiles }));
        }

    }

    /**
     * 注册插件（init 后、bindEvents 后调用）
     */
    registerPlugin(plugin: InputPlugin): void {

        this.plugins.push(plugin);
        this.plugins.sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

        // Track known plugins for typed access
        if (plugin.id === 'token-meter') {
            this.tokenMeterPlugin = plugin as TokenMeterPlugin;
        }

        if (this.pluginCtx) {
            plugin.activate(this.pluginCtx);
        }
    }

    private initPluginSystem(): void {
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

        for (const plugin of this.plugins) {
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
        this.agentPickerBtn.disabled = loading;
        this.connectionTier.setLoading(loading);
        this.attachBtn.disabled = loading;
        this.settingsBtn.disabled = loading;
        if (this.moreBtn) this.moreBtn.disabled = loading;

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
            this.updateAgentTrigger();
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
            this.currentAgentId = agentId;
            this.updateAgentTrigger();
        }
        this.textarea.focus();
        this.textarea.selectionStart = this.textarea.selectionEnd = this.textarea.value.length;
    }

    focus(): void {
        this.textarea?.focus();
    }

    refreshAgents(agents: ExecutorOption[], validateAgentId: (id: string) => string): boolean {
        const currentAgentId = this.config.agentId;
        this.updateExecutors(agents);

        const validatedId = validateAgentId(currentAgentId);
        const changed = validatedId !== currentAgentId;

        if (changed) {
            this.config.agentId = validatedId;
            this.currentAgentId = validatedId;
            this.config.settings.modelTier = 'auto';
            this.connectionTier.setModelTier('auto');
            this.updateActiveBadges();
        }

        this.updateAgentTrigger();
        return changed;
    }

    updateTokenStats(stats: import('../../domain/types').TokenStats | null): void {
        this.tokenMeterPlugin?.update(stats);
    }

    /**
     * Inline tool output panel — appears above the textarea, inside the ChatInput.
     * Replaces any previous output so the panel shows only the latest command.
     * Dismissed by the × button or when the user sends an agent message.
     */
    showToolOutput(cmd: string, output: string, success: boolean): void {
        this.toolOutput.show(cmd, output, success);
    }

    clearToolOutput(): void {
        this.toolOutput.clear();
    }

    destroy(): void {
        if (this.outsideClickHandler) {
            document.removeEventListener('click', this.outsideClickHandler);
            this.outsideClickHandler = null;
        }
        this.agentPopup?.destroy();
        this.agentPopup = null;
        this.connectionTier.destroy();
        this.promptPopup?.destroy();
        this.promptPopup = null;
        this.morePopup?.destroy();
        this.morePopup = null;
        this.attachmentMgr?.destroy();
        this.helpPanel.destroy();
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
        this.updateHistoryDisplay();

        this.attachmentMgr = new AttachmentManager({
            container: this.container,
            fileInput: this.fileInput,
            attachmentContainer: this.attachmentContainer,
            textarea: this.textarea,
            inputWrapper: this.inputWrapper,
            attachBtn: this.attachBtn,
            onOcrImage: this.options.onOcrImage,
            onRequestFiles: this.options.onRequestFiles,
            getLoading: () => this.loading,
            getFiles: () => this.files,
            setFiles: (f) => { this.files = f; },
            notifyConfigChange: () => this.notifyConfigChange(),
        });
    }

    private bindElements(): void {
        const q = <T extends HTMLElement>(sel: string): T =>
            this.container.querySelector(sel) as T;

        this.textarea = q('.llm-input__textarea');
        this.sendBtn = q('.llm-input__btn--send');
        this.stopBtn = q('.llm-input__btn--stop');
        this.attachBtn = q('.llm-input__btn--attach');
        this.settingsBtn = q('.llm-input__btn--settings');
        this.webSearchQuickBtn = q('.llm-input__btn--websearch');
        this.moreBtn = q('.llm-input__btn--more');

        // Agent Picker combobox elements
        this.agentPickerBtn = q('.llm-input__agent-trigger');
        this.agentIconEl = q('.llm-input__agent-icon');
        this.agentNameEl = q('.llm-input__agent-name');
        this.agentMetaEl = q('.llm-input__agent-meta');

        // Prompt picker elements (in toolbar)
        this.promptPickerWrapper = q('.llm-input__prompt-picker-wrapper');
        this.promptPickerBtn = q('.llm-input__prompt-picker');

        this.historySlider = q('.llm-input__history-slider');
        this.historyValue = this.container.querySelector('.llm-input__history-value');
        this.streamToggle = q('.llm-input__stream-toggle');
        this.settingsPanel = q('.llm-input__settings-panel');
        this.flowIdInput = q('.llm-input__flow-id');
        this.branchModeSelect = q('.llm-input__branch-mode');
        this.retentionModeSelect = q('.llm-input__retention-mode');
        this.fileInput = q('.llm-input__file-input');
        this.attachmentContainer = q('.llm-input__attachments');
        this.inputWrapper = q('.llm-input__field-wrapper');

        // Help panel (button is inside the more popup — bound lazily in toggleMoreMenu)
        // Session profile
        this.systemPromptAppendInput = this.container.querySelector('.llm-input__system-prompt-append') as HTMLTextAreaElement;
    }

    private bindEvents(): void {
        this.webSearchQuickBtn?.addEventListener('click', () => {
            const next = !(this.config.settings.webSearchEnabled ?? true);
            this.config.settings.webSearchEnabled = next;
            this.syncWebSearchUI(next);
            this.notifyConfigChange();
        });
        this.flowIdInput?.addEventListener('input', () => { this.config.settings.flowId = this.flowIdInput.value.trim() || undefined; this.notifyConfigChange(); });
        this.branchModeSelect?.addEventListener('change', () => {
            this.config.settings.branchMode =
                this.branchModeSelect.value === 'fork' ? 'fork' : 'continue';
            this.notifyConfigChange();
        });
        this.retentionModeSelect?.addEventListener('change', () => {
            this.config.settings.retentionMode =
                this.retentionModeSelect.value === 'temporary'
                    ? 'temporary'
                    : 'persistent';
            this.notifyConfigChange();
        });
        this.textarea.addEventListener('input', () => {
            this.adjustTextareaHeight();
            this.config.text = this.textarea.value;
            this.notifyConfigChange();
            // Close help when user starts typing
            if (this.helpPanel.isVisible && this.textarea.value.length > 0) this.hideHelp();

            const cursorPos = this.textarea.selectionStart;
            for (const plugin of this.plugins) {
                plugin.onInput?.(this.textarea.value, cursorPos);
            }
        });

        this.textarea.addEventListener('keydown', (e) => {
            // Esc closes help panel before propagating to plugins
            if (e.key === 'Escape' && this.helpPanel.isVisible) {
                e.preventDefault();
                this.hideHelp();
                return;
            }

            for (const plugin of this.plugins) {
                if (plugin.onKeyDown?.(e)) {
                    return;
                }
            }

            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.triggerSend();
            }
        });

        this.textarea.addEventListener('paste', (e) => this.attachmentMgr.handlePaste(e));

        this.sendBtn.addEventListener('click', () => this.triggerSend());
        this.stopBtn.addEventListener('click', () => this.options.onStop());
        this.attachBtn.addEventListener('click', () => this.attachmentMgr.toggleAddMenu(
            (anchor, opts) => new PopupPanel(anchor, opts)
        ));
        this.settingsBtn.addEventListener('click', () => this.toggleSettings());
        this.moreBtn?.addEventListener('click', () => this.toggleMoreMenu());

        this.container.querySelector('.llm-input__settings-close')
            ?.addEventListener('click', () => this.toggleSettings(false));

        this.fileInput.addEventListener('change', () => {
            if (this.fileInput.files) {
                this.attachmentMgr.addFiles(Array.from(this.fileInput.files));
                this.fileInput.value = '';
            }
        });

        // Attachment chips use event delegation: one listener on the persistent
        // container, dispatched by selector. Re-rendering innerHTML never rebinds.
        delegate(this.attachmentContainer, 'click', '.llm-input__remove-btn', ({ event, index }) => {
            event.stopPropagation();
            if (Number.isNaN(index)) return;
            this.files.splice(index, 1);
            this.attachmentMgr.renderAttachments();
        });
        delegate(this.attachmentContainer, 'click', '.llm-input__ocr-btn', ({ event, index }) => {
            event.stopPropagation();
            if (Number.isNaN(index)) return;
            this.attachmentMgr.ocrImage(this.files[index], index);
        });
        delegate(this.attachmentContainer, 'click', '.llm-input__ocr-all-btn', ({ event }) => {
            event.stopPropagation();
            this.attachmentMgr.ocrAllImages();
        });

        this.bindSettingsEvents();
        this.attachmentMgr.bindDragEvents();
        this.bindOutsideClickHandler();

        // 初始化插件系统（放在所有事件绑定之后）
        this.initPluginSystem();
    }

    private bindSettingsEvents(): void {
        // Agent Picker combobox — popup handled by PopupPanel
        this.agentPickerBtn.addEventListener('click', () => this.toggleAgentPicker());

        // Prompt picker — popup handled by PopupPanel
        this.promptPickerBtn?.addEventListener('click', () => this.togglePromptPicker());

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
            // Block Mode checked → streaming disabled
            this.config.settings.streamMode = !this.streamToggle.checked;
            this.updateStreamToggleLabel();
            this.updateActiveBadges();
            this.notifyConfigChange();
        });

        const thinkingToggle = this.container.querySelector('.llm-input__thinking-toggle') as HTMLInputElement | null;
        const reasoningRow = this.container.querySelector('.llm-input__reasoning-wrapper') as HTMLElement | null;
        const reasoningSelect = this.container.querySelector('.llm-input__reasoning-select') as HTMLSelectElement | null;

        const syncThinkingUI = () => {
            const on = thinkingToggle?.checked ?? true;
            if (reasoningRow) reasoningRow.style.display = on ? '' : 'none';
        };

        thinkingToggle?.addEventListener('change', () => {
            syncThinkingUI();
            this.config.settings.thinkingEnabled = thinkingToggle?.checked;
            this.notifyConfigChange();
        });

        reasoningSelect?.addEventListener('change', () => {
            const val = reasoningSelect.value as 'auto' | 'low' | 'medium' | 'xhigh';
            this.config.settings.reasoningEffort = val;
            this.notifyConfigChange();
        });

        const webSearchToggle = this.container.querySelector('.llm-input__websearch-toggle') as HTMLInputElement | null;
        webSearchToggle?.addEventListener('change', () => {
            this.config.settings.webSearchEnabled = webSearchToggle?.checked;
            this.syncWebSearchUI(webSearchToggle?.checked ?? true);
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
                this.clearSetting(clearType as 'connection' | 'tier' | 'history' | 'stream');
            });
        });

        // Connection badge click → navigate to edit that connection
        const connBadge = this.container.querySelector('.llm-input__active-badge[data-type="connection"]') as HTMLElement | null;
        connBadge?.addEventListener('click', (e) => {
            // Don't navigate if the × clear button was clicked (handled above)
            if ((e.target as HTMLElement).closest('.llm-input__badge-clear')) return;
            const connId = connBadge.dataset.connectionId ?? this.config.settings.connectionId;
            if (connId) this.options.onNavigateSettings?.({ resourceId: 'connections', anchor: `conn:${connId}` });
        });

        // Session profile — system prompt append
        this.systemPromptAppendInput?.addEventListener('input', () => {
            this.config.settings.systemPromptAppend = this.systemPromptAppendInput.value.trim() || undefined;
            this.notifyConfigChange();
        });
    }

    private bindOutsideClickHandler(): void {
        this.outsideClickHandler = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (this.settingsExpanded) {
                if (!this.settingsPanel.contains(target) && !this.settingsBtn.contains(target)) {
                    this.toggleSettings(false);
                }
            }
        };
        document.addEventListener('click', this.outsideClickHandler);
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
        this.attachmentMgr.renderAttachments();

        // Clear the inline tool output when sending to the agent —
        // the user is switching from tool mode back to conversation mode.
        this.clearToolOutput();

        await this.options.onSend(text, currentFiles, currentExecutor, overrides);

        // ✨ after 钩子
        for (const plugin of this.plugins) {
            plugin.onAfterSend?.(text, currentExecutor);
        }
    }

    private buildOverrides(): ChatOverrides {
        const overrides: ChatOverrides = {};
        if (this.config.settings.connectionId) overrides.connectionId = this.config.settings.connectionId;
        // 'auto' means no override — only pass an explicit tier
        const tier = this.config.settings.modelTier;
        if (tier && tier !== 'auto') overrides.modelTier = tier as ModelTier;
        if (this.config.settings.historyLength !== -1) overrides.historyLength = this.config.settings.historyLength;
        if (this.config.settings.temperature !== undefined) overrides.temperature = this.config.settings.temperature;
        if (!this.config.settings.streamMode) overrides.streamMode = false;

        // Reasoning effort override
        const effort = this.config.settings.reasoningEffort;
        if (effort && effort !== 'auto') {
            overrides.reasoningEffort = effort;
        }
        // Thinking toggle (undefined=auto, true=force on, false=force off)
        if (this.config.settings.thinkingEnabled !== undefined) {
            overrides.thinkingEnabled = this.config.settings.thinkingEnabled;
        }
        // Web search toggle (undefined=auto → provider 自动决策，true=强制开，false=强制关)
        if (this.config.settings.webSearchEnabled !== undefined) {
            overrides.webSearchEnabled = this.config.settings.webSearchEnabled;
        }
        // Session profile — system prompt append
        if (this.config.settings.systemPromptAppend) {
            overrides.systemPromptAppend = this.config.settings.systemPromptAppend;
        }
        if (this.config.settings.flowId) overrides.flowId = this.config.settings.flowId;
        if (this.config.settings.flowRevision !== undefined) {
            overrides.flowRevision = this.config.settings.flowRevision;
        }
        if (this.config.settings.flowParameters) {
            overrides.flowParameters = this.config.settings.flowParameters;
        }
        if (this.config.settings.branchMode === 'fork') overrides.branchMode = 'fork';
        if (this.config.settings.retentionMode === 'temporary') overrides.retentionMode = 'temporary';

        return overrides;
    }

    // ================================================================
    // 连接加载
    // ================================================================

    async refreshConnections(): Promise<void> {
        await this.loadConnections();
    }

    selectFlow(flowId: string, revision: number, parameters?: Record<string, JsonValue>): void {
        this.config.settings.flowId = flowId;
        this.config.settings.flowRevision = revision;
        this.config.settings.flowParameters = parameters;
        if (this.flowIdInput) this.flowIdInput.value = flowId;
        this.notifyConfigChange();
        this.focus();
    }

    private async loadConnections(): Promise<void> {
        if (!this.options.onRequestConnections) return;
        try {
            this.connectionTier.setConnections(await this.options.onRequestConnections());
        } catch (e) {
            console.error('[ChatInput] Failed to load connections:', e);
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
        if (this.agentPickerBtn) this.updateAgentTrigger();
        this.connectionTier.setConnectionId(this.config.settings.connectionId);
        this.connectionTier.setModelTier(this.config.settings.modelTier ?? 'auto');
        if (this.flowIdInput) this.flowIdInput.value = this.config.settings.flowId ?? '';
        if (this.branchModeSelect) this.branchModeSelect.value = this.config.settings.branchMode ?? 'continue';
        if (this.retentionModeSelect) this.retentionModeSelect.value = this.config.settings.retentionMode ?? 'persistent';
        if (this.historySlider) {
            this.historySlider.value = (this.config.settings.historyLength ?? -1).toString();
            this.updateHistoryDisplay();
            this.updatePresetButtons();
        }
        if (this.streamToggle) {
            // Block Mode toggle is inverted: checked = block mode = streaming disabled
            this.streamToggle.checked = !(this.config.settings.streamMode ?? true);
            this.updateStreamToggleLabel();
        }
        // Sync thinking toggle and reasoning effort from persisted settings.
        const thinkingToggle = this.container.querySelector('.llm-input__thinking-toggle') as HTMLInputElement | null;
        const reasoningRow = this.container.querySelector('.llm-input__reasoning-wrapper') as HTMLElement | null;
        const reasoningSelect = this.container.querySelector('.llm-input__reasoning-select') as HTMLSelectElement | null;
        if (thinkingToggle) {
            thinkingToggle.checked = this.config.settings.thinkingEnabled ?? true;
            if (reasoningRow) reasoningRow.style.display = thinkingToggle.checked ? '' : 'none';
        }
        if (reasoningSelect && this.config.settings.reasoningEffort) {
            reasoningSelect.value = this.config.settings.reasoningEffort;
        }
        const webSearchToggle = this.container.querySelector('.llm-input__websearch-toggle') as HTMLInputElement | null;
        if (webSearchToggle) {
            webSearchToggle.checked = this.config.settings.webSearchEnabled ?? true;
        }
        this.syncWebSearchUI(this.config.settings.webSearchEnabled ?? true);
        if (this.systemPromptAppendInput) {
            this.systemPromptAppendInput.value = this.config.settings.systemPromptAppend ?? '';
        }
        this.updateActiveBadges();
    }

    private syncConfigFromUI(): void {
        this.config.text = this.textarea?.value || '';
        this.config.agentId = this.currentAgentId;
        this.config.settings.connectionId = this.connectionTier.getConnectionId();
        // modelTier is kept in-memory; pills don't have a native value to read
        this.config.settings.historyLength = parseInt(this.historySlider?.value || '-1');
        this.config.settings.streamMode = !(this.streamToggle?.checked ?? false);
        this.config.settings.systemPromptAppend = this.systemPromptAppendInput?.value.trim() || undefined;
    }

    /** 同步联网搜索状态到工具栏快速开关（高亮）与设置面板 toggle。 */
    private syncWebSearchUI(active: boolean): void {
        if (this.webSearchQuickBtn) {
            this.webSearchQuickBtn.dataset.active = active ? 'true' : 'false';
        }
        const panelToggle = this.container.querySelector('.llm-input__websearch-toggle') as HTMLInputElement | null;
        if (panelToggle) panelToggle.checked = active;
    }

    private adjustTextareaHeight(): void {
        this.textarea.style.height = 'auto';
        const lineHeight = parseFloat(getComputedStyle(this.textarea).lineHeight) || 24;
        const minHeight = lineHeight * 2 + 8; // 2 rows + padding
        const newHeight = Math.max(minHeight, Math.min(this.textarea.scrollHeight, 200));
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
            // Lazily load skills when panel opens (skills always visible now)
            if (this.options.onRequestSkills) {
                this.skillPanel.reload();
            }
        }
    }

    private clearSetting(type: 'connection' | 'tier' | 'history' | 'stream'): void {
        switch (type) {
            case 'connection':
                this.connectionTier.setConnectionId(undefined);
                this.config.settings.connectionId = undefined;
                break;
            case 'tier':
                this.config.settings.modelTier = 'auto';
                this.connectionTier.setModelTier('auto');
                break;
            case 'history':
                this.historySlider.value = '-1';
                this.config.settings.historyLength = -1;
                this.updateHistoryDisplay();
                this.updatePresetButtons();
                break;
            case 'stream':
                this.streamToggle.checked = false; // uncheck = streaming (not block mode)
                this.config.settings.streamMode = true;
                this.updateStreamToggleLabel();
                break;
        }
        this.updateActiveBadges();
        this.notifyConfigChange();
    }

    private updateHistoryDisplay(): void {
        if (!this.historyValue) return; // element removed in new template; presets show state
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

    // ── More menu ─────────────────────────────────────────────────────────────

    /**
     * 切换 "..." 更多菜单。
     *
     * 菜单内容：Help（始终）+ Prompt Picker 入口（有 prompts 时）。
     * 使用 PopupPanel 实现，锚点为 moreBtn。
     */
    private toggleMoreMenu(): void {
        if (!this.morePopup) {
            this.morePopup = new PopupPanel(this.moreBtn, {
                showSearch: false,
                animated: true,
            });
        }
        if (this.morePopup.isVisible) {
            this.morePopup.hide();
            this.moreBtn.classList.remove('active');
            return;
        }

        const items = this.buildMoreMenuItems();
        this.morePopup.show(items, {
            onSelect: (item) => {
                this.moreBtn.classList.remove('active');
                if (item.id === '__help') this.toggleHelp();
                else if (item.id === '__prompts') this.togglePromptPicker();
            },
        });
        this.moreBtn.classList.add('active');
    }

    private buildMoreMenuItems(): PopupItem[] {
        const items: PopupItem[] = [
            { id: '__help', label: 'Keyboard shortcuts & commands', icon: '?' },
        ];
        if (this.getCurrentPrompts().length > 0) {
            items.push({ id: '__prompts', label: 'Preset Prompts', icon: '💬' });
        }
        return items;
    }

    // ── Help panel ────────────────────────────────────────────────────────────

    /**
     * 显示内嵌帮助面板。
     *
     * 帮助内容根据当前配置动态生成：
     * - 基础分区：键盘快捷键、slash 命令列表
     * - @mention 分区：当 onRequestFiles 回调已注入时显示
     */
    showHelp(): void {
        this.helpPanel.show();
    }

    private hideHelp(): void {
        this.helpPanel.hide();
    }

    private toggleHelp(): void {
        this.helpPanel.toggle();
    }

    // ── Skill management ─────────────────────────────────────────────────────

    /**
     * 刷新 Skill 列表（由 Shell 注入 skills 数据或内部主动拉取）。
     *
     * Shell 在 kernel 可用时调用此方法传入最新 skill 列表；
     * 也可在用户点击 Refresh 按钮时由内部调用 onRequestSkills 回调。
     */
    refreshSkills(skills: SkillInfo[]): void {
        this.skillPanel.refresh(skills);
    }

    private updateActiveBadges(): void {
        const activeContainer = this.container.querySelector('.llm-input__active-settings') as HTMLElement;
        const connBadge    = this.container.querySelector('.llm-input__active-badge[data-type="connection"]') as HTMLElement;
        const tierBadge    = this.container.querySelector('.llm-input__active-badge[data-type="tier"]') as HTMLElement;
        const streamBadge  = this.container.querySelector('.llm-input__active-badge[data-type="stream"]') as HTMLElement;
        const historyBadge = this.container.querySelector('.llm-input__active-badge[data-type="history"]') as HTMLElement;

        if (!activeContainer) return;
        let hasActive = false;

        if (this.config.settings.connectionId) {
            const conn = this.connectionTier.getConnections().find(c => c.id === this.config.settings.connectionId);
            const text = connBadge?.querySelector('.llm-input__badge-text');
            if (text) text.textContent = conn?.name || this.config.settings.connectionId;
            if (connBadge) {
                connBadge.dataset.connectionId = this.config.settings.connectionId;
                connBadge.style.display = 'inline-flex';
            }
            hasActive = true;
        } else if (connBadge) {
            delete connBadge.dataset.connectionId;
            connBadge.style.display = 'none';
        }

        const tier = this.config.settings.modelTier;
        if (tier && tier !== 'auto') {
            const TIER_LABELS: Record<string, string> = { optimal: '最优', standard: '标准', fast: '快速' };
            const text = tierBadge?.querySelector('.llm-input__badge-text');
            if (text) text.textContent = TIER_LABELS[tier] ?? tier;
            if (tierBadge) tierBadge.style.display = 'inline-flex';
            hasActive = true;
        } else if (tierBadge) { tierBadge.style.display = 'none'; }

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
        const config = this.getConfig();
        const settingsJson = JSON.stringify(config.settings);
        if (settingsJson === this.lastNotifiedSettings) return;
        this.lastNotifiedSettings = settingsJson;
        this.options.onConfigChange?.(config);
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
        this.agents = executors;
        this.updateAgentTrigger();
    }

    // ── Agent Picker methods ──────────────────────────────────────────────────

    private getOrCreateAgentPopup(): PopupPanel {
        if (!this.agentPopup) {
            this.agentPopup = new PopupPanel(this.agentPickerBtn, {
                showSearch: true,
                searchPlaceholder: 'Search by name, provider...',
                emptyText: 'No agents match',
                animated: true,
            });
        }
        return this.agentPopup;
    }

    private openAgentPicker(): void {
        this.connectionTier.hidePopups();
        const popup = this.getOrCreateAgentPopup();
        popup.show(this.buildAgentItems(), {
            onSelect: (item) => this.selectAgent(item.id),
        });
    }

    private toggleAgentPicker(): void {
        const popup = this.getOrCreateAgentPopup();
        if (popup.isVisible) popup.hide();
        else this.openAgentPicker();
    }

    /** Convert agents list to PopupItem[] for the picker. */
    private buildAgentItems(): PopupItem[] {
        return this.agents.map(a => {
            const meta = [a.provider, a.connectionName].filter(Boolean).join(' · ');
            return {
                id: a.id,
                label: a.name,
                icon: a.icon ?? '🤖',
                description: meta || undefined,
                group: a.category,
                searchText: [a.provider, a.connectionName, a.category].filter(Boolean).join(' '),
            };
        });
    }

    /** Select an agent from the picker. */
    private selectAgent(id: string): void {
        this.config.agentId = id;
        this.currentAgentId = id;
        this.updateAgentTrigger();
        this.connectionTier.refreshForAgentChange();
        this.options.onExecutorChange?.(id);
        this.notifyConfigChange();
    }

    /** Update trigger button text/icon/meta from current agentId. */
    private updateAgentTrigger(): void {
        const agent = this.agents.find(a => a.id === this.config.agentId);
        if (!this.agentNameEl) return;
        if (agent) {
            this.agentIconEl.textContent = agent.icon ?? '🤖';
            this.agentNameEl.textContent = agent.name;
            const meta = [agent.provider, agent.connectionName].filter(Boolean).join(' · ');
            this.agentMetaEl.textContent = meta;
            this.agentMetaEl.style.display = meta ? '' : 'none';
        } else {
            this.agentIconEl.textContent = '🤖';
            this.agentNameEl.textContent = 'Assistant';
            this.agentMetaEl.textContent = '';
            this.agentMetaEl.style.display = 'none';
        }
        this.updatePromptPickerVisibility();
    }

    // ── Prompt Picker methods ─────────────────────────────────────────────────

    /** Current agent's preset prompts (empty when none configured). */
    private getCurrentPrompts(): import('@itookit/common').PromptPreset[] {
        const agent = this.agents.find(a => a.id === this.config.agentId);
        return agent?.defaultPrompts ?? [];
    }

    /** Show/hide the prompt picker pill based on whether the agent has presets. */
    private updatePromptPickerVisibility(): void {
        if (!this.promptPickerWrapper) return;
        const hasPrompts = this.getCurrentPrompts().length > 0;
        this.promptPickerWrapper.style.display = hasPrompts ? '' : 'none';
        if (!hasPrompts) this.promptPopup?.hide();
    }

    private getOrCreatePromptPopup(): PopupPanel {
        if (!this.promptPopup) {
            this.promptPopup = new PopupPanel(this.promptPickerBtn, {
                maxVisible: 12,
                showSearch: true,
                searchPlaceholder: 'Search prompts...',
                emptyText: 'No preset prompts',
                animated: true,
            });
        }
        return this.promptPopup;
    }

    private openPromptPicker(): void {
        this.agentPopup?.hide();
        this.connectionTier.hidePopups();
        const popup = this.getOrCreatePromptPopup();
        popup.show(this.buildPromptItems(), {
            onSelect: (item) => this.selectPrompt(parseInt(item.id, 10)),
        });
    }

    private togglePromptPicker(): void {
        const popup = this.getOrCreatePromptPopup();
        if (popup.isVisible) popup.hide();
        else this.openPromptPicker();
    }

    /** Convert preset prompts to PopupItem[] (id = index). */
    private buildPromptItems(): PopupItem[] {
        return this.getCurrentPrompts().map((p, i) => ({
            id: String(i),
            label: p.name || `Prompt ${i + 1}`,
            icon: '💬',
            description: p.prompt.replace(/\s+/g, ' ').slice(0, 60),
            searchText: `${p.name} ${p.prompt}`,
        }));
    }

    /** Insert the selected preset prompt into the textarea at the cursor. */
    private selectPrompt(index: number): void {
        const prompt = this.getCurrentPrompts()[index]?.prompt;
        if (!prompt) return;
        this.pluginCtx?.insertAtCursor(prompt);
        this.config.text = this.textarea.value;
        this.notifyConfigChange();
        this.textarea.focus();
    }

}
