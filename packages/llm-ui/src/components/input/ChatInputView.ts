// @file: llm-ui/components/input/ChatInputView.ts

import type { IChatInputPresenter, IChatInputConfig } from '../../domain/ports/IChatInputPresenter';
import type {
    ExecutorOption, ConnectionOption,
    ChatOverrides, SkillInfo, FileSuggestion,
} from '../../domain/types';
import type { ModelTier } from '@itookit/common';
import { ChatInputTemplates } from '../templates/ChatInputTemplates';
import type { InputPlugin, InputPluginContext } from './plugins/InputPlugin';
import { MentionPlugin } from './plugins/MentionPlugin';
import { TokenMeterPlugin } from './plugins/TokenMeterPlugin';
import { PopupPanel } from './plugins/PopupPanel';
import type { PopupItem } from './plugins/PopupPanel';
import { AttachmentManager } from './AttachmentManager';
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

    // ── Harness callbacks ────────────────────────────────────────────────────

    /**
     * 获取可用 Skill 列表（含 loaded 状态）。
     *
     * 仅在 harness 模式可用时由 Shell 注入。
     * ChatInput 在设置面板打开时调用此函数刷新列表。
     */
    onRequestSkills?: () => Promise<SkillInfo[]>;

    /**
     * 加载 Skill 到当前 harness 会话。
     *
     * 调用后 harness 的 IToolService 会注册该 Skill 的工具，
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
    // Settings panel still has a native connection select for Settings-panel usage
    private connectionSelect!: HTMLSelectElement;
    private tierPillsContainer!: HTMLElement;
    private historySlider!: HTMLInputElement;
    private historyValue: HTMLSpanElement | null = null; // removed from new template
    private streamToggle!: HTMLInputElement;
    private settingsPanel!: HTMLElement;
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

    // ── Connection Quick Switch (popup via PopupPanel) ───────────────────────
    private connQuickBtn!: HTMLButtonElement;
    private connQuickLabel!: HTMLSpanElement;
    private connQuickClear!: HTMLElement;
    private connPopup: PopupPanel | null = null;

    // ── Tier Quick Switch (popup via PopupPanel) ─────────────────────────────
    private tierQuickBtn!: HTMLButtonElement;
    private tierQuickLabel!: HTMLSpanElement;
    private tierQuickClear!: HTMLElement;
    private tierPopup: PopupPanel | null = null;

    // ── Prompt Picker (preset prompts dropdown, popup via PopupPanel) ────────
    private promptPickerWrapper!: HTMLElement;
    private promptPickerBtn!: HTMLButtonElement;
    private promptPopup: PopupPanel | null = null;

    private outsideClickHandler: ((e: MouseEvent) => void) | null = null;
    private loading = false;
    private files: File[] = [];
    private settingsExpanded = false;
    private connections: ConnectionOption[] = [];
    private currentAgentId: string = 'default';

    // ── Mode / harness DOM elements ──────────────────────────────────────────
    private harnessToggle!: HTMLInputElement;
    private harnessToggleLabel!: HTMLSpanElement; // kept for backward compat; may be absent
    private cwdRow!: HTMLElement;
    private cwdInput!: HTMLInputElement;
    private skillSection!: HTMLElement;
    private skillsList!: HTMLElement;

    // ── Help panel ───────────────────────────────────────────────────────────
    private helpBtn!: HTMLButtonElement; // lives inside more popup, bound lazily
    private helpPanel!: HTMLElement;
    private helpBody!: HTMLElement;
    private helpVisible = false;

    // ── More menu ─────────────────────────────────────────────────────────────
    private moreBtn!: HTMLButtonElement;
    private morePopup: PopupPanel | null = null;

    // ── Tool output panel ─────────────────────────────────────────────────────
    private toolOutputEl: HTMLElement | null = null;

    // ── Session profile ───────────────────────────────────────────────────────
    private systemPromptAppendInput!: HTMLTextAreaElement;

    // ── Harness state ────────────────────────────────────────────────────────
    private skills: SkillInfo[] = [];
    private isLoadingSkills = false;

    // ── Plugin system ────────────────────────────────────────────────────────
    private plugins: InputPlugin[] = [];
    private pluginCtx: InputPluginContext | null = null;
    private tokenMeterPlugin: TokenMeterPlugin | null = null;

    // ── Attachment manager ────────────────────────────────────────────────────
    private attachmentMgr!: AttachmentManager;

    private config: IChatInputConfig = {
        text: '',
        agentId: 'default',
        settings: { connectionId: undefined, modelTier: 'auto', historyLength: -1, streamMode: true, useHarness: false, workingDirectory: '' },
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
        console.log(`[ChatInput] registerPlugin: ${plugin.id}, priority: ${plugin.priority ?? 100}`);

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
        this.connQuickBtn.disabled = loading;
        this.tierQuickBtn.disabled = loading;
        this.connectionSelect.disabled = loading;
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
            this.updateTierPills('auto');
            this.updateTierQuick();
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
        if (!this.toolOutputEl) {
            this.toolOutputEl = document.createElement('div');
            this.toolOutputEl.className = 'llm-input__tool-output';
            // Insert above the field wrapper so it sits between executor selector and textarea.
            const wrapper = this.container.querySelector('.llm-input__field-wrapper');
            const parent = wrapper?.parentElement ?? this.container;
            parent.insertBefore(this.toolOutputEl, wrapper ?? parent.firstChild);
        }

        const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const lines = output.split('\n').length;
        const icon = success ? '✅' : '❌';

        this.toolOutputEl.innerHTML = `
            <div class="llm-input__tool-output-header">
                <code class="llm-input__tool-output-cmd">$ ${esc(cmd)}</code>
                <span class="llm-input__tool-output-meta">${icon} ${lines} line${lines !== 1 ? 's' : ''}</span>
                <button class="llm-input__tool-output-close" type="button" title="Close">×</button>
            </div>
            <pre class="llm-input__tool-output-body">${esc(output)}</pre>`;

        this.toolOutputEl.style.display = 'block';
        this.toolOutputEl.querySelector('.llm-input__tool-output-close')?.addEventListener('click', () => {
            this.clearToolOutput();
        });

        // Scroll output into view and refocus textarea for next command.
        this.toolOutputEl.scrollIntoView?.({ block: 'nearest' });
        this.textarea?.focus();
    }

    clearToolOutput(): void {
        if (this.toolOutputEl) {
            this.toolOutputEl.style.display = 'none';
            this.toolOutputEl.innerHTML = '';
        }
    }

    destroy(): void {
        if (this.outsideClickHandler) {
            document.removeEventListener('click', this.outsideClickHandler);
            this.outsideClickHandler = null;
        }
        this.agentPopup?.destroy();
        this.agentPopup = null;
        this.connPopup?.destroy();
        this.connPopup = null;
        this.tierPopup?.destroy();
        this.tierPopup = null;
        this.promptPopup?.destroy();
        this.promptPopup = null;
        this.morePopup?.destroy();
        this.morePopup = null;
        this.attachmentMgr?.destroy();
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
        this.updateConnectionOptions();
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
        this.moreBtn = q('.llm-input__btn--more');

        // Agent Picker combobox elements
        this.agentPickerBtn = q('.llm-input__agent-trigger');
        this.agentIconEl = q('.llm-input__agent-icon');
        this.agentNameEl = q('.llm-input__agent-name');
        this.agentMetaEl = q('.llm-input__agent-meta');

        // Connection quick-switch elements
        this.connQuickBtn = q('.llm-input__conn-quick');
        this.connQuickLabel = q('.llm-input__conn-quick-label');
        this.connQuickClear = q('.llm-input__conn-quick-clear');

        // Tier quick-switch elements
        this.tierQuickBtn = q('.llm-input__tier-quick');
        this.tierQuickLabel = q('.llm-input__tier-quick-label');
        this.tierQuickClear = q('.llm-input__tier-quick-clear');

        // Prompt picker elements (in toolbar)
        this.promptPickerWrapper = q('.llm-input__prompt-picker-wrapper');
        this.promptPickerBtn = q('.llm-input__prompt-picker');

        this.connectionSelect = q('.llm-input__connection-select');
        this.tierPillsContainer = q('.llm-input__tier-cards');
        this.historySlider = q('.llm-input__history-slider');
        this.historyValue = this.container.querySelector('.llm-input__history-value');
        this.streamToggle = q('.llm-input__stream-toggle');
        this.settingsPanel = q('.llm-input__settings-panel');
        this.fileInput = q('.llm-input__file-input');
        this.attachmentContainer = q('.llm-input__attachments');
        this.inputWrapper = q('.llm-input__field-wrapper');

        // Mode / skills controls
        this.harnessToggle = q('.llm-input__harness-toggle');
        this.harnessToggleLabel = this.container.querySelector('.llm-input__harness-toggle-label') as HTMLSpanElement;
        this.cwdRow = q('.llm-input__cwd-wrapper');
        this.cwdInput = q('.llm-input__cwd-input');
        this.skillSection = q('.llm-input__skill-section');
        this.skillsList = q('.llm-input__skills-list');

        // Help panel (button is inside the more popup — bound lazily in toggleMoreMenu)
        this.helpPanel = q('.llm-input__help-panel');
        this.helpBody = q('.llm-input__help-body');
        // helpBtn is assigned in bindHelpEvents() after the popup renders
        this.helpBtn = document.createElement('button'); // placeholder to avoid null checks

        // Session profile
        this.systemPromptAppendInput = this.container.querySelector('.llm-input__system-prompt-append') as HTMLTextAreaElement;
    }

    private bindEvents(): void {
        this.textarea.addEventListener('input', () => {
            this.adjustTextareaHeight();
            this.config.text = this.textarea.value;
            this.notifyConfigChange();
            // Close help when user starts typing
            if (this.helpVisible && this.textarea.value.length > 0) this.hideHelp();

            const cursorPos = this.textarea.selectionStart;
            for (const plugin of this.plugins) {
                plugin.onInput?.(this.textarea.value, cursorPos);
            }
        });

        this.textarea.addEventListener('keydown', (e) => {
            // Esc closes help panel before propagating to plugins
            if (e.key === 'Escape' && this.helpVisible) {
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
        this.bindHelpEvents();
        this.bindOutsideClickHandler();

        // ✅ 初始化插件系统（放在所有事件绑定之后）
        this.initPluginSystem();
    }

    private bindSettingsEvents(): void {
        // Agent Picker combobox — popup handled by PopupPanel
        this.agentPickerBtn.addEventListener('click', () => this.toggleAgentPicker());

        // Connection quick-switch — popup handled by PopupPanel
        this.connQuickBtn.addEventListener('click', (e) => {
            // ×-clear button sits inside the quick button — intercept it
            if ((e.target as HTMLElement).closest('.llm-input__conn-quick-clear')) {
                this.selectConnection('');
                return;
            }
            this.toggleConnPicker();
        });

        // Tier quick-switch — popup handled by PopupPanel
        this.tierQuickBtn.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).closest('.llm-input__tier-quick-clear')) {
                this.selectTier('auto');
                return;
            }
            this.toggleTierPicker();
        });

        // Prompt picker — popup handled by PopupPanel
        this.promptPickerBtn?.addEventListener('click', () => this.togglePromptPicker());

        // Settings panel connection select — keeps in sync with conn-quick and tier card model names
        this.connectionSelect.addEventListener('change', () => {
            this.config.settings.connectionId = this.connectionSelect.value || undefined;
            this.updateConnQuick();
            this.updateTierCardModels();
            this.updateActiveBadges();
            this.notifyConfigChange();
        });

        this.tierPillsContainer?.addEventListener('click', (e) => {
            const pill = (e.target as HTMLElement).closest('.llm-input__tier-card') as HTMLElement | null;
            if (!pill) return;
            const tier = pill.dataset.tier as 'auto' | ModelTier;
            if (!tier) return;
            this.config.settings.modelTier = tier;
            this.updateTierPills(tier);
            this.updateTierQuick();
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

        // ── Mode toggle (Simple / Full) ──────────────────────────────────────
        this.harnessToggle?.addEventListener('change', () => {
            const enabled = this.harnessToggle.checked;
            console.log('[ChatInput] harness toggle changed:', enabled);
            this.config.settings.useHarness = enabled;
            this.updateHarnessToggleLabel();
            this.updateHarnessVisibility();
            this.updateActiveBadges();
            this.notifyConfigChange();
        });

        this.cwdInput?.addEventListener('change', () => {
            this.config.settings.workingDirectory = this.cwdInput.value.trim();
            this.notifyConfigChange();
        });

        // Skill list delegation — toggle checkbox drives load/unload
        this.skillSection?.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement;
            if (!target.matches('.llm-input__skill-btn')) return;
            const skillId = target.dataset.skill;
            if (!skillId) return;
            if (target.checked) {
                this.loadSkill(skillId);
            } else {
                this.unloadSkill(skillId);
            }
        });

        // Skills refresh button (click, not change)
        this.container.querySelector('.llm-input__skills-refresh')
            ?.addEventListener('click', () => this.reloadSkills());

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

        // Harness overrides
        if (this.config.settings.useHarness) {
            overrides.useHarness = true;
            if (this.config.settings.workingDirectory) {
                overrides.workingDirectory = this.config.settings.workingDirectory;
            }
        }

        // Reasoning effort override
        const effort = this.config.settings.reasoningEffort;
        if (effort && effort !== 'auto') {
            overrides.reasoningEffort = effort;
        }
        // Thinking toggle (undefined=auto, true=force on, false=force off)
        if (this.config.settings.thinkingEnabled !== undefined) {
            overrides.thinkingEnabled = this.config.settings.thinkingEnabled;
        }
        // Session profile — system prompt append
        if (this.config.settings.systemPromptAppend) {
            overrides.systemPromptAppend = this.config.settings.systemPromptAppend;
        }

        return overrides;
    }

    // ================================================================
    // 连接加载
    // ================================================================

    private async loadConnections(): Promise<void> {
        if (!this.options.onRequestConnections) return;
        try {
            this.connections = await this.options.onRequestConnections();
            this.updateConnectionOptions();
            this.updateConnQuick();
            this.updateTierQuick();
            this.updateTierCardModels();
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
        if (this.connectionSelect && this.config.settings.connectionId) {
            this.connectionSelect.value = this.config.settings.connectionId;
        }
        if (this.connQuickBtn) this.updateConnQuick();
        this.updateTierPills(this.config.settings.modelTier ?? 'auto');
        if (this.tierQuickBtn) this.updateTierQuick();
        this.updateTierCardModels();
        if (this.historySlider) {
            this.historySlider.value = this.config.settings.historyLength.toString();
            this.updateHistoryDisplay();
            this.updatePresetButtons();
        }
        if (this.streamToggle) {
            // Block Mode toggle is inverted: checked = block mode = streaming disabled
            this.streamToggle.checked = !this.config.settings.streamMode;
            this.updateStreamToggleLabel();
        }
        if (this.harnessToggle) {
            console.log('[ChatInput] syncUIFromConfig useHarness:', this.config.settings.useHarness);
            this.harnessToggle.checked = this.config.settings.useHarness ?? false;
            this.updateHarnessVisibility();
        }
        if (this.cwdInput && this.config.settings.workingDirectory) {
            this.cwdInput.value = this.config.settings.workingDirectory;
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
        if (this.systemPromptAppendInput) {
            this.systemPromptAppendInput.value = this.config.settings.systemPromptAppend ?? '';
        }
        this.updateActiveBadges();
    }

    private syncConfigFromUI(): void {
        this.config.text = this.textarea?.value || '';
        this.config.agentId = this.currentAgentId;
        this.config.settings.connectionId = this.connectionSelect?.value || undefined;
        // modelTier is kept in-memory; pills don't have a native value to read
        this.config.settings.historyLength = parseInt(this.historySlider?.value || '-1');
        this.config.settings.streamMode = !(this.streamToggle?.checked ?? false);
        this.config.settings.useHarness = this.harnessToggle?.checked ?? false;
        this.config.settings.workingDirectory = this.cwdInput?.value.trim() ?? '';
        this.config.settings.systemPromptAppend = this.systemPromptAppendInput?.value.trim() || undefined;
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
            if (this.skills.length === 0 && this.options.onRequestSkills) {
                this.reloadSkills();
            }
        }
    }

    private clearSetting(type: 'connection' | 'tier' | 'history' | 'stream'): void {
        switch (type) {
            case 'connection':
                this.connectionSelect.value = '';
                this.config.settings.connectionId = undefined;
                break;
            case 'tier':
                this.config.settings.modelTier = 'auto';
                this.updateTierPills('auto');
                this.updateTierQuick();
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
     * - Agent Mode 分区：当 harness 已配置时显示
     */
    showHelp(): void {
        if (this.helpVisible) return;

        const hasHarness = !!this.options.onLoadSkill;  // harness wired = skill callback injected
        const hasFiles = !!this.options.onRequestFiles;

        this.helpBody.innerHTML = ChatInputTemplates.renderHelpContent(hasHarness, hasFiles);
        this.helpPanel.style.display = 'block';
        this.helpBtn.classList.add('active');
        this.helpVisible = true;

        // Close settings panel if open
        this.toggleSettings(false);
    }

    private hideHelp(): void {
        if (!this.helpVisible) return;
        this.helpPanel.style.display = 'none';
        this.helpBtn.classList.remove('active');
        this.helpVisible = false;
    }

    private toggleHelp(): void {
        if (this.helpVisible) this.hideHelp();
        else this.showHelp();
    }

    private bindHelpEvents(): void {
        // Close button inside panel
        this.helpPanel?.querySelector('.llm-input__help-close')
            ?.addEventListener('click', () => this.hideHelp());

        // Click outside help panel closes it (moreBtn not excluded since help is triggered via popup)
        document.addEventListener('click', (e: MouseEvent) => {
            if (this.helpVisible && !this.helpPanel.contains(e.target as Node)) {
                this.hideHelp();
            }
        });
    }

    private updateHarnessToggleLabel(): void {
        // Legacy label element may not exist in new template; tolerate gracefully
        if (this.harnessToggleLabel) {
            this.harnessToggleLabel.textContent = this.config.settings.useHarness ? 'Full' : 'Simple';
        }
    }

    private updateHarnessVisibility(): void {
        const fullMode = this.config.settings.useHarness;
        // Working dir only relevant in Full mode
        if (this.cwdRow) this.cwdRow.style.display = fullMode ? '' : 'none';
        // Skills are always visible — they affect system prompt in both modes
    }

    // ── Skill management ─────────────────────────────────────────────────────

    /**
     * 刷新 Skill 列表（由 Shell 注入 skills 数据或内部主动拉取）。
     *
     * Shell 在 harness 可用时调用此方法传入最新 skill 列表；
     * 也可在用户点击 Refresh 按钮时由内部调用 onRequestSkills 回调。
     */
    refreshSkills(skills: SkillInfo[]): void {
        this.skills = skills;
        this.renderSkillsList();
    }

    private async reloadSkills(): Promise<void> {
        if (!this.options.onRequestSkills || this.isLoadingSkills) return;
        this.isLoadingSkills = true;
        this.skillsList.innerHTML = '<span class="llm-input__skills-empty">Loading…</span>';
        try {
            const skills = await this.options.onRequestSkills();
            this.refreshSkills(skills);
        } catch {
            this.skillsList.innerHTML = '<span class="llm-input__skills-empty">Failed to load skills</span>';
        } finally {
            this.isLoadingSkills = false;
        }
    }

    private renderSkillsList(): void {
        if (!this.skillsList) return;
        if (this.skills.length === 0) {
            this.skillsList.innerHTML = '<span class="llm-input__skills-empty">No skills available</span>';
            return;
        }
        this.skillsList.innerHTML = this.skills
            .map((s) => ChatInputTemplates.renderSkillItem(s))
            .join('');
    }

    private async loadSkill(skillId: string): Promise<void> {
        if (!this.options.onLoadSkill) return;
        const btn = this.skillsList.querySelector(`[data-skill="${skillId}"]`) as HTMLButtonElement | null;
        if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
        try {
            await this.options.onLoadSkill(skillId);
            // Update local state and re-render
            const skill = this.skills.find((s) => s.id === skillId);
            if (skill) skill.loaded = true;
            this.renderSkillsList();
        } catch (e) {
            console.error('[ChatInput] loadSkill failed:', e);
            if (btn) { btn.disabled = false; btn.textContent = 'Load'; }
        }
    }

    private async unloadSkill(skillId: string): Promise<void> {
        if (!this.options.onUnloadSkill) return;
        const btn = this.skillsList.querySelector(`[data-skill="${skillId}"]`) as HTMLButtonElement | null;
        if (btn) { btn.disabled = true; btn.textContent = 'Unloading…'; }
        try {
            await this.options.onUnloadSkill(skillId);
            const skill = this.skills.find((s) => s.id === skillId);
            if (skill) skill.loaded = false;
            this.renderSkillsList();
        } catch (e) {
            console.error('[ChatInput] unloadSkill failed:', e);
            if (btn) { btn.disabled = false; btn.textContent = 'Unload'; }
        }
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
            const conn = this.connections.find(c => c.id === this.config.settings.connectionId);
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
        this.updateConnQuick();
    }

    private updateTierPills(tier: 'auto' | ModelTier): void {
        this.tierPillsContainer?.querySelectorAll('.llm-input__tier-card').forEach(card => {
            card.classList.toggle('active', (card as HTMLElement).dataset.tier === tier);
        });
    }

    /** Refresh the model-name subtitle on each tier card to match the currently selected connection. */
    private updateTierCardModels(): void {
        const tiers = this.resolveEffectiveTiers();

        // 'auto' card shows the optimal model name (indicates what will actually be used)
        const modelLabels: Record<string, string> = {
            auto:     tiers.optimal ?? '',
            optimal:  tiers.optimal ?? '',
            standard: tiers.standard ?? '',
            fast:     tiers.fast ?? '',
        };

        this.tierPillsContainer?.querySelectorAll('[data-tier-model]').forEach(el => {
            const t = (el as HTMLElement).dataset.tierModel ?? '';
            el.textContent = modelLabels[t] ?? '';
        });
    }

    private notifyConfigChange(): void {
        const config = this.getConfig();
        console.log('[ChatInput] notifyConfigChange useHarness:', config.settings?.useHarness);
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

    private updateConnectionOptions(): void {
        if (!this.connectionSelect) return;
        this.connectionSelect.innerHTML = ChatInputTemplates.renderConnectionOptions(
            this.connections, this.config.settings.connectionId
        );
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
        this.connPopup?.hide();
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
        this.updateTierCardModels();
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
        this.connPopup?.hide();
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

    // ── Connection Quick-Switch methods ──────────────────────────────────────

    private getOrCreateConnPopup(): PopupPanel {
        if (!this.connPopup) {
            this.connPopup = new PopupPanel(this.connQuickBtn, {
                emptyText: 'No connections',
                animated: true,
            });
        }
        return this.connPopup;
    }

    private openConnPicker(): void {
        this.agentPopup?.hide();
        const popup = this.getOrCreateConnPopup();
        popup.show(this.buildConnItems(), {
            onSelect: (item) => {
                if (item.id === '__manage') {
                    this.options.onNavigateSettings?.({ resourceId: 'connections' });
                    return;
                }
                this.selectConnection(item.id);
            },
        });
    }

    private toggleConnPicker(): void {
        const popup = this.getOrCreateConnPopup();
        if (popup.isVisible) popup.hide();
        else this.openConnPicker();
    }

    /** Convert connections to PopupItem[] for the picker. */
    private buildConnItems(): PopupItem[] {
        const currentId = this.config.settings.connectionId ?? '';
        const items: PopupItem[] = [
            { id: '', label: 'Agent Default', icon: currentId === '' ? '✓' : '' },
        ];
        for (const c of this.connections) {
            items.push({
                id: c.id,
                label: c.name,
                description: c.provider,
                icon: c.id === currentId ? '✓' : (c.hasTiers ? '⚡' : ''),
            });
        }
        items.push(
            { id: '__manage', label: '管理连接 →', icon: '⚙️', description: '配置 Provider 和模型层级' },
        );
        return items;
    }

    /** Select a connection from the quick-switch popup ('' = clear override). */
    private selectConnection(id: string): void {
        this.config.settings.connectionId = id || undefined;
        if (this.connectionSelect) this.connectionSelect.value = id;
        this.updateConnQuick();
        this.updateTierCardModels();
        this.updateActiveBadges();
        this.notifyConfigChange();
    }

    /** Update the conn-quick button label and clear button visibility. */
    private updateConnQuick(): void {
        if (!this.connQuickLabel) return;
        const id = this.config.settings.connectionId;
        if (id) {
            const conn = this.connections.find(c => c.id === id);
            this.connQuickLabel.textContent = conn?.name ?? id;
            this.connQuickClear.style.display = '';
            this.connQuickBtn.classList.add('llm-input__conn-quick--active');
        } else {
            this.connQuickLabel.textContent = 'Default';
            this.connQuickClear.style.display = 'none';
            this.connQuickBtn.classList.remove('llm-input__conn-quick--active');
        }
    }

    // ── Tier Quick-Switch methods ─────────────────────────────────────────────

    private getOrCreateTierPopup(): PopupPanel {
        if (!this.tierPopup) {
            this.tierPopup = new PopupPanel(this.tierQuickBtn, {
                emptyText: 'No tiers configured',
                animated: true,
            });
        }
        return this.tierPopup;
    }

    private openTierPicker(): void {
        this.connPopup?.hide();
        this.agentPopup?.hide();
        const popup = this.getOrCreateTierPopup();
        popup.show(this.buildTierItems(), {
            onSelect: (item) => this.selectTier(item.id as 'auto' | ModelTier),
        });
    }

    private toggleTierPicker(): void {
        const popup = this.getOrCreateTierPopup();
        if (popup.isVisible) popup.hide();
        else this.openTierPicker();
    }

    /**
     * Resolve the effective tier→modelName map for the current session.
     * Priority: connection override → agent's default connection → first available connection.
     */
    private resolveEffectiveTiers(): Partial<Record<string, string>> {
        const overrideId = this.config.settings.connectionId;
        let conn = overrideId
            ? this.connections.find(c => c.id === overrideId)
            : undefined;

        if (!conn) {
            const agent = this.agents.find(a => a.id === this.config.agentId);
            conn = agent?.connectionId
                ? this.connections.find(c => c.id === agent.connectionId)
                : this.connections[0];
        }
        return conn?.tiers ?? {};
    }

    /** Build tier popup items, resolving model names from the selected connection's tiers. */
    private buildTierItems(): PopupItem[] {
        const currentTier = this.config.settings.modelTier ?? 'auto';
        const tierMap = this.resolveEffectiveTiers();

        const items: PopupItem[] = [
            { id: 'auto', label: 'Auto', description: 'Use agent default', icon: currentTier === 'auto' ? '✓' : '' },
            { id: 'optimal', label: '最优', description: tierMap.optimal, icon: currentTier === 'optimal' ? '✓' : '' },
        ];
        if (tierMap.standard) {
            items.push({ id: 'standard', label: '标准', description: tierMap.standard, icon: currentTier === 'standard' ? '✓' : '' });
        }
        if (tierMap.fast) {
            items.push({ id: 'fast', label: '快速', description: tierMap.fast, icon: currentTier === 'fast' ? '✓' : '' });
        }
        return items;
    }

    /** Select a tier from the quick-switch popup ('auto' = clear override). */
    private selectTier(tier: 'auto' | ModelTier): void {
        this.config.settings.modelTier = tier;
        this.updateTierQuick();
        this.updateTierPills(tier);
        this.updateActiveBadges();
        this.notifyConfigChange();
    }

    /** Update the tier-quick button label, active class, and clear button visibility. */
    private updateTierQuick(): void {
        if (!this.tierQuickLabel) return;
        const tier = this.config.settings.modelTier ?? 'auto';
        const TIER_LABELS: Record<string, string> = { auto: 'Auto', optimal: '最优', standard: '标准', fast: '快速' };
        this.tierQuickLabel.textContent = TIER_LABELS[tier] ?? tier;
        if (tier !== 'auto') {
            this.tierQuickClear.style.display = '';
            this.tierQuickBtn.classList.add('llm-input__tier-quick--active');
        } else {
            this.tierQuickClear.style.display = 'none';
            this.tierQuickBtn.classList.remove('llm-input__tier-quick--active');
        }
    }
}
