// @file: llm-ui/components/input/ChatInputView.ts

import type { IChatInputPresenter, IChatInputConfig } from '../../domain/ports/IChatInputPresenter';
import type {
    ExecutorOption, ConnectionOption,
    ChatOverrides, SkillInfo, FileSuggestion,
} from '../../domain/types';
import type { ModelTier } from '@itookit/common';
import type { IAgentRuntime } from '@itookit/common';
import { ChatInputTemplates } from '../templates/ChatInputTemplates';
import type { InputPlugin, InputPluginContext } from './plugins/InputPlugin';
import type { HarnessPlugin } from './plugins/HarnessPlugin';
import { MentionPlugin } from './plugins/MentionPlugin';
import { TokenMeterPlugin } from './plugins/TokenMeterPlugin';

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
    private connectionSelect!: HTMLSelectElement;
    private tierPillsContainer!: HTMLElement;
    private historySlider!: HTMLInputElement;
    private historyValue: HTMLSpanElement | null = null; // removed from new template
    private streamToggle!: HTMLInputElement;
    private settingsPanel!: HTMLElement;
    private fileInput!: HTMLInputElement;
    private attachmentContainer!: HTMLElement;
    private inputWrapper!: HTMLElement;

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
    private helpBtn!: HTMLButtonElement;
    private helpPanel!: HTMLElement;
    private helpBody!: HTMLElement;
    private helpVisible = false;

    // ── Tool output panel ─────────────────────────────────────────────────────
    private toolOutputEl: HTMLElement | null = null;

    // ── Harness state ────────────────────────────────────────────────────────
    private skills: SkillInfo[] = [];
    private isLoadingSkills = false;

    // ── Plugin system ────────────────────────────────────────────────────────
    private plugins: InputPlugin[] = [];
    private pluginCtx: InputPluginContext | null = null;
    private harnessPlugin: HarnessPlugin | null = null;
    private tokenMeterPlugin: TokenMeterPlugin | null = null;

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
        if (plugin.id === 'harness-status') {
            this.harnessPlugin = plugin as HarnessPlugin;
        }
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
        this.executorSelect.disabled = loading;
        this.connectionSelect.disabled = loading;
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
        validateAgentId: (id: string) => string  // ✅ 签名简化，不再需要 agents 参数
    ): boolean {
        const currentAgentId = this.config.agentId;
        this.updateExecutors(agents);

        const validatedId = validateAgentId(currentAgentId);
        const changed = validatedId !== currentAgentId;

        if (changed) {
            this.config.agentId = validatedId;
            this.currentAgentId = validatedId;
            this.config.settings.modelTier = 'auto';
            this.updateTierPills('auto');
            this.updateActiveBadges();
        }

        this.setExecutorValue(this.config.agentId);
        return changed;
    }

    setHarnessRuntime(runtime: IAgentRuntime | null): void {
        if (this.harnessPlugin) {
            this.harnessPlugin.setRuntime(runtime);
        }
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
        this.injectHelpStyles();
    }

    private injectHelpStyles(): void {
        if (document.getElementById('llm-input-help-styles')) return;
        const s = document.createElement('style');
        s.id = 'llm-input-help-styles';
        s.textContent = `
.llm-input__btn--help { opacity: 0.6; font-size: 13px; }
.llm-input__btn--help:hover, .llm-input__btn--help.active { opacity: 1; }

.llm-input__help-panel {
    border-radius: 8px 8px 0 0;
    border: 1px solid var(--border-color, #e0e0e0);
    border-bottom: none;
    background: var(--bg-primary, #fff);
    max-height: 420px;
    overflow-y: auto;
    box-shadow: 0 -4px 16px rgba(0,0,0,.08);
}
.llm-input__help-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px 8px;
    border-bottom: 1px solid var(--border-color, #e0e0e0);
    position: sticky;
    top: 0;
    background: var(--bg-primary, #fff);
    z-index: 1;
}
.llm-input__help-title { font-weight: 600; font-size: 13px; color: var(--text-primary, #333); }
.llm-input__help-close {
    background: none; border: none; cursor: pointer;
    font-size: 18px; line-height: 1; color: var(--text-secondary, #888);
    padding: 0 2px;
}
.llm-input__help-close:hover { color: var(--text-primary, #333); }
.llm-input__help-body { padding: 4px 0 8px; }

.llm-input__help-section { padding: 8px 14px 4px; }
.llm-input__help-section + .llm-input__help-section {
    border-top: 1px solid var(--border-color-subtle, #f0f0f0);
}
.llm-input__help-section-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: .05em;
    color: var(--text-tertiary, #aaa);
    margin: 0 0 6px;
}
.llm-input__help-section-desc {
    font-size: 12px;
    color: var(--text-secondary, #666);
    margin: 0 0 6px;
}

.llm-input__help-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
}
.llm-input__help-table tr { vertical-align: top; }
.llm-input__help-table td {
    padding: 2px 6px 2px 0;
    color: var(--text-primary, #333);
    white-space: nowrap;
}
.llm-input__help-table td:last-child { white-space: normal; color: var(--text-secondary, #666); }
.llm-input__help-group {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--text-tertiary, #bbb);
    padding-top: 8px !important;
    padding-bottom: 2px !important;
}

kbd {
    display: inline-block;
    padding: 1px 5px;
    font-size: 11px;
    font-family: monospace;
    background: var(--bg-secondary, #f5f5f5);
    border: 1px solid var(--border-color, #ddd);
    border-radius: 3px;
    color: var(--text-primary, #333);
    white-space: nowrap;
}
code {
    font-size: 11px;
    font-family: monospace;
    background: var(--bg-secondary, #f5f5f5);
    padding: 1px 4px;
    border-radius: 3px;
}

.llm-input__help-hint {
    font-size: 11px;
    color: var(--text-tertiary, #aaa);
    margin: 4px 0 0;
}
.llm-input__help-hint code { background: none; padding: 0; }
.llm-input__help-dim { font-size: 10px; color: var(--text-tertiary, #aaa); }

.llm-input__help-footer {
    font-size: 11px;
    color: var(--text-tertiary, #aaa);
    padding: 6px 14px 4px;
    border-top: 1px solid var(--border-color-subtle, #f0f0f0);
    margin: 0;
}
`;
        document.head.appendChild(s);
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
        this.connectionSelect = q('.llm-input__connection-select');
        this.tierPillsContainer = q('.llm-input__tier-pills');
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
        this.cwdRow = q('.llm-input__cwd-row');
        this.cwdInput = q('.llm-input__cwd-input');
        this.skillSection = q('.llm-input__skill-section');
        this.skillsList = q('.llm-input__skills-list');

        // Help panel
        this.helpBtn = q('.llm-input__btn--help');
        this.helpPanel = q('.llm-input__help-panel');
        this.helpBody = q('.llm-input__help-body');
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
        this.bindHelpEvents();
        this.bindOutsideClickHandler();

        // ✅ 初始化插件系统（放在所有事件绑定之后）
        this.initPluginSystem();
    }

    private bindSettingsEvents(): void {
        this.executorSelect.addEventListener('change', () => {
            const newAgentId = this.executorSelect.value;
            this.config.agentId = newAgentId;
            if (newAgentId !== this.currentAgentId) {
                this.currentAgentId = newAgentId;
            }
            this.options.onExecutorChange?.(newAgentId);
            this.notifyConfigChange();
        });

        this.connectionSelect.addEventListener('change', () => {
            this.config.settings.connectionId = this.connectionSelect.value || undefined;
            this.updateActiveBadges();
            this.notifyConfigChange();
        });

        this.tierPillsContainer?.addEventListener('click', (e) => {
            const pill = (e.target as HTMLElement).closest('.llm-input__tier-pill') as HTMLElement | null;
            if (!pill) return;
            const tier = pill.dataset.tier as 'auto' | ModelTier;
            if (!tier) return;
            this.config.settings.modelTier = tier;
            this.updateTierPills(tier);
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
                this.clearSetting(clearType as 'connection' | 'tier' | 'history' | 'stream');
            });
        });

        // ── Mode toggle (Simple / Full) ──────────────────────────────────────
        this.harnessToggle?.addEventListener('change', () => {
            const enabled = this.harnessToggle.checked;
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
        if (this.executorSelect) this.setExecutorValue(this.config.agentId);
        if (this.connectionSelect && this.config.settings.connectionId) {
            this.connectionSelect.value = this.config.settings.connectionId;
        }
        this.updateTierPills(this.config.settings.modelTier ?? 'auto');
        if (this.historySlider) {
            this.historySlider.value = this.config.settings.historyLength.toString();
            this.updateHistoryDisplay();
            this.updatePresetButtons();
        }
        if (this.streamToggle) {
            this.streamToggle.checked = this.config.settings.streamMode;
            this.updateStreamToggleLabel();
        }
        if (this.harnessToggle) {
            this.harnessToggle.checked = this.config.settings.useHarness ?? false;
            this.updateHarnessVisibility();
        }
        if (this.cwdInput && this.config.settings.workingDirectory) {
            this.cwdInput.value = this.config.settings.workingDirectory;
        }
        this.updateActiveBadges();
    }

    private syncConfigFromUI(): void {
        this.config.text = this.textarea?.value || '';
        this.config.agentId = this.executorSelect?.value || 'default';
        this.config.settings.connectionId = this.connectionSelect?.value || undefined;
        // modelTier is kept in-memory; pills don't have a native value to read
        this.config.settings.historyLength = parseInt(this.historySlider?.value || '-1');
        this.config.settings.streamMode = this.streamToggle?.checked ?? true;
        this.config.settings.useHarness = this.harnessToggle?.checked ?? false;
        this.config.settings.workingDirectory = this.cwdInput?.value.trim() ?? '';
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
        this.helpBtn?.addEventListener('click', () => this.toggleHelp());

        // Close button inside panel
        this.helpPanel?.querySelector('.llm-input__help-close')
            ?.addEventListener('click', () => this.hideHelp());

        // Click outside help panel closes it
        document.addEventListener('click', (e: MouseEvent) => {
            if (
                this.helpVisible &&
                !this.helpPanel.contains(e.target as Node) &&
                !this.helpBtn.contains(e.target as Node)
            ) {
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
            if (connBadge) connBadge.style.display = 'inline-flex';
            hasActive = true;
        } else if (connBadge) { connBadge.style.display = 'none'; }

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

    private updateTierPills(tier: 'auto' | ModelTier): void {
        this.tierPillsContainer?.querySelectorAll('.llm-input__tier-pill').forEach(pill => {
            pill.classList.toggle('active', (pill as HTMLElement).dataset.tier === tier);
        });
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

    private updateConnectionOptions(): void {
        if (!this.connectionSelect) return;
        this.connectionSelect.innerHTML = ChatInputTemplates.renderConnectionOptions(
            this.connections, this.config.settings.connectionId
        );
    }

    private setExecutorValue(id: string): void {
        const option = this.executorSelect.querySelector(`option[value="${id}"]`);
        this.executorSelect.value = option ? id : 'default';
    }
}
