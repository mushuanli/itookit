// @file: llm-ui/views/templates/ChatInputTemplates.ts

import { escapeHTML } from '@itookit/common';
import { ExecutorOption, ModelOption } from '../../domain/types';

export const ChatInputTemplates = {

    /**
     * 渲染完整的 ChatInput 组件
     */
    renderMain(): string {
        return `
            <div class="llm-input">
                ${this.renderHelpPanel()}
                ${this.renderSettingsPanel()}
                ${this.renderInputArea()}
                <input type="file" multiple style="display:none;" class="llm-input__file-input">
            </div>
        `;
    },

    /**
     * 渲染设置面板
     */
    renderSettingsPanel(): string {
        return `
            <div class="llm-input__settings-panel" style="display: none; overflow-y: auto; max-height: 420px;">
                <div class="llm-input__settings-header">
                    <span class="llm-input__settings-title">
                        ${this.settingsIcon()}
                        Settings
                    </span>
                    <button class="llm-input__settings-close" title="Close">
                        ${this.closeIcon()}
                    </button>
                </div>

                <div class="llm-input__settings-body">
                    ${this.renderModelSetting()}
                    ${this.renderContextSetting()}
                    ${this.renderModeSetting()}
                    ${this.renderSkillsSetting()}
                    ${this.renderAdvancedSection()}
                </div>
            </div>
        `;
    },

    /**
     * 模型覆盖设置行
     */
    renderModelSetting(): string {
        return `
            <div class="llm-input__setting-row">
                <label class="llm-input__setting-label">
                    <span class="llm-input__setting-icon">🧠</span>
                    Model
                </label>
                <select class="llm-input__model-select" title="Override model for this session">
                    <option value="">Agent Default</option>
                </select>
            </div>
        `;
    },

    /**
     * Context 长度设置 — radio-pill 预设取代 slider + 独立预设行
     */
    renderContextSetting(): string {
        return `
            <div class="llm-input__setting-row">
                <label class="llm-input__setting-label">
                    <span class="llm-input__setting-icon">📜</span>
                    Context
                </label>
                <div class="llm-input__preset-buttons" role="group" aria-label="Context length">
                    <button class="llm-input__preset-btn" data-history="0"  title="No history — fresh start">Fresh</button>
                    <button class="llm-input__preset-btn" data-history="5"  title="Last 5 messages">Short</button>
                    <button class="llm-input__preset-btn" data-history="20" title="Last 20 messages">Long</button>
                    <button class="llm-input__preset-btn active" data-history="-1" title="Full history">All</button>
                </div>
            </div>
            <input type="range" class="llm-input__history-slider" min="-1" max="50" value="-1"
                   style="display:none" aria-hidden="true">
        `;
    },

    /**
     * Mode 切换（Simple = 单轮 LLM / Full = 多轮 Agent Loop with tools）
     *
     * 取代旧的 "harness toggle" — 使用用户可理解的语言。
     * Simple 是默认模式；Full 开启 AgentLoopExecutor。
     */
    renderModeSetting(): string {
        return `
            <div class="llm-input__setting-row llm-input__harness-section">
                <label class="llm-input__toggle" title="Enable multi-turn agent loop with file tools">
                    <input type="checkbox" class="llm-input__harness-toggle">
                    <span class="llm-input__toggle-slider"></span>
                </label>
                <span style="margin-left:8px;">Advanced Mode</span>
            </div>

            <div class="llm-input__setting-row llm-input__cwd-row" style="display:none">
                <label class="llm-input__setting-label">
                    <span class="llm-input__setting-icon">📁</span>
                    Working dir
                </label>
                <input type="text"
                       class="llm-input__cwd-input"
                       placeholder="Default"
                       title="Root directory for file and shell tools">
            </div>
        `;
    },

    /**
     * Skills 面板 — 始终可见（影响 system prompt，与 Mode 无关）
     *
     * 每个 Skill 以 toggle 开关控制当前会话是否启用。
     */
    renderSkillsSetting(): string {
        return `
            <div class="llm-input__setting-divider">
                Skills
                <button class="llm-input__skills-refresh" title="Refresh">↺</button>
            </div>
            <div class="llm-input__skill-section">
                <div class="llm-input__skills-list">
                    <span class="llm-input__skills-empty">No skills available</span>
                </div>
            </div>
        `;
    },

    /**
     * 渲染单个 Skill 条目 — toggle switch 样式
     */
    renderSkillItem(skill: { id: string; name: string; description: string; loaded: boolean; toolCount: number; icon?: string }): string {
        const icon = skill.icon ? escapeHTML(skill.icon) : '⚡';
        const checked = skill.loaded ? 'checked' : '';
        const btnClass = skill.loaded ? 'llm-input__skill-btn--unload' : 'llm-input__skill-btn--load';
        const desc = skill.description ? `: <span class="llm-input__skill-desc">${escapeHTML(skill.description)}</span>` : '';

        return `
            <div class="llm-input__skill-item${skill.loaded ? ' llm-input__skill-item--loaded' : ''}"
                 data-skill-id="${escapeHTML(skill.id)}">
                <label class="llm-input__toggle llm-input__skill-toggle" title="${skill.loaded ? 'Disable skill' : 'Enable skill'}">
                    <input type="checkbox" class="llm-input__skill-btn ${btnClass}"
                           data-skill="${escapeHTML(skill.id)}" ${checked}>
                    <span class="llm-input__toggle-slider"></span>
                </label>
                <span class="llm-input__skill-icon">${icon}</span>
                <span class="llm-input__skill-name">${escapeHTML(skill.name)}</span>${desc}
            </div>
        `;
    },

    /**
     * Advanced 折叠区 — 放置用户极少修改的选项（Streaming）
     */
    renderAdvancedSection(): string {
        return `
            <details class="llm-input__advanced">
                <summary class="llm-input__setting-divider llm-input__advanced-toggle">Advanced</summary>
                <div class="llm-input__setting-row">
                    <label class="llm-input__toggle" title="Stream response as it generates">
                        <input type="checkbox" class="llm-input__stream-toggle" checked>
                        <span class="llm-input__toggle-slider"></span>
                    </label>
                    <span style="margin-left:8px;">Streaming</span>
                </div>
            </details>
        `;
    },

    /**
     * 渲染主输入区域
     */
    renderInputArea(): string {
        return `
            <div class="llm-input__main">
                ${this.renderExecutorSelector()}
                ${this.renderFieldWrapper()}
                ${this.renderActions()}
            </div>
        `;
    },

    /**
     * Agent 选择器
     */
    renderExecutorSelector(): string {
        return `
            <div class="llm-input__executor-wrapper">
                <select class="llm-input__executor-select" title="Select Agent/Executor">
                    <option value="default">🤖 Assistant</option>
                </select>
            </div>
        `;
    },

    /**
     * 输入字段包装器（含附件预览和活动设置指示器）
     */
    renderFieldWrapper(): string {
        return `
            <div class="llm-input__field-wrapper">
                <div class="llm-input__attachments" style="display:none"></div>
                ${this.renderActiveBadges()}
                <textarea 
                    class="llm-input__textarea" 
                    placeholder="Message... (Paste images or Drag & Drop)" 
                    rows="1"
                ></textarea>
            </div>
        `;
    },

    /**
     * 活动设置徽章区域
     */
    renderActiveBadges(): string {
        return `
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
        `;
    },

    /**
     * 操作按钮组
     */
    renderActions(): string {
        return `
            <div class="llm-input__actions">
                <button class="llm-input__btn llm-input__btn--help" title="Show keyboard shortcuts &amp; commands (?)">
                    ${this.helpIcon()}
                </button>
                <button class="llm-input__btn llm-input__btn--settings" title="Chat Settings">
                    ${this.sliderIcon()}
                </button>
                <button class="llm-input__btn llm-input__btn--attach" title="Attach File">
                    ${this.attachIcon()}
                </button>
                <button class="llm-input__btn llm-input__btn--send" title="Send">
                    ${this.sendIcon()}
                </button>
                <button class="llm-input__btn llm-input__btn--stop" title="Stop Generation" style="display:none;">
                    ${this.stopIcon()}
                </button>
            </div>
        `;
    },

    /**
     * 帮助面板骨架（挂载在 .llm-input 根节点内）。
     *
     * 内容由 ChatInputView.renderHelpContent() 动态写入 .llm-input__help-body。
     */
    renderHelpPanel(): string {
        return `
            <div class="llm-input__help-panel" style="display:none;" role="dialog" aria-label="ChatInput help">
                <div class="llm-input__help-header">
                    <span class="llm-input__help-title">How to use</span>
                    <button class="llm-input__help-close" title="Close help (Esc)">×</button>
                </div>
                <div class="llm-input__help-body"></div>
            </div>
        `;
    },

    /**
     * 帮助面板内容（动态注入）。
     *
     * @param hasHarness  是否启用了 AgentLoopExecutor（决定是否显示 Agent Mode 分区）
     * @param hasFiles    是否注入了 onRequestFiles（决定是否显示 @ 分区）
     */
    renderHelpContent(hasHarness: boolean, hasFiles: boolean): string {
        const agentSection = hasHarness ? `
            <section class="llm-input__help-section">
                <h3 class="llm-input__help-section-title">🤖 Agent Mode</h3>
                <p class="llm-input__help-section-desc">
                    Enable <b>Agent Loop</b> in Settings to use multi-turn AI with tools.
                </p>
                <table class="llm-input__help-table">
                    <tr><td><kbd>/skill &lt;id&gt;</kbd></td><td>Load a skill into the agent</td></tr>
                    <tr><td><kbd>/skills</kbd></td><td>Browse &amp; manage available skills</td></tr>
                    <tr><td><kbd>/tools</kbd></td><td>Show registered tools</td></tr>
                    <tr><td><kbd>Settings → Agent Loop</kbd></td><td>Toggle harness mode</td></tr>
                    <tr><td><kbd>Settings → Working Dir</kbd></td><td>Set file tool root directory</td></tr>
                </table>
                <p class="llm-input__help-hint">
                    Built-in tools: <code>file_read</code> <code>file_write</code>
                    <code>shell_exec</code> <code>glob_search</code> <code>grep_search</code>
                </p>
            </section>` : '';

        const fileSection = hasFiles ? `
            <section class="llm-input__help-section">
                <h3 class="llm-input__help-section-title">@ File References</h3>
                <table class="llm-input__help-table">
                    <tr><td><kbd>@filename</kbd></td><td>Type @ to open file picker</td></tr>
                    <tr><td>Select a file</td><td>Inserts <code>[file.md](./path)</code> → AI reads its content</td></tr>
                    <tr><td>Images</td><td>Inserts <code>![img.png](./path)</code> → sent as vision attachment</td></tr>
                </table>
            </section>` : '';

        return `
            <section class="llm-input__help-section">
                <h3 class="llm-input__help-section-title">⌨ Keyboard Shortcuts</h3>
                <table class="llm-input__help-table">
                    <tr><td><kbd>Enter</kbd></td><td>Send message</td></tr>
                    <tr><td><kbd>Shift+Enter</kbd></td><td>New line</td></tr>
                    <tr><td><kbd>↑</kbd> <span class="llm-input__help-dim">(empty input)</span></td><td>Browse prompt history</td></tr>
                    <tr><td><kbd>Ctrl+R</kbd></td><td>Search prompt history</td></tr>
                    <tr><td><kbd>Esc</kbd></td><td>Close active panel</td></tr>
                    <tr><td><kbd>Cmd+K</kbd></td><td>Toggle navigation panel</td></tr>
                    <tr><td><kbd>Cmd+↑↓</kbd></td><td>Navigate between messages</td></tr>
                </table>
            </section>

            <section class="llm-input__help-section">
                <h3 class="llm-input__help-section-title">/ Slash Commands</h3>
                <p class="llm-input__help-section-desc">Type <kbd>/</kbd> to open the command picker.</p>
                <table class="llm-input__help-table">
                    <tr><th colspan="2" class="llm-input__help-group">Chat</th></tr>
                    <tr><td><kbd>/new</kbd> [title]</td><td>Start a new chat</td></tr>
                    <tr><td><kbd>/retry</kbd></td><td>Regenerate last response</td></tr>
                    <tr><td><kbd>/continue</kbd></td><td>Continue generation</td></tr>
                    <tr><td><kbd>/reedit</kbd></td><td>Re-edit last message</td></tr>
                    <tr><td><kbd>/delete</kbd></td><td>Delete last message pair</td></tr>
                    <tr><td><kbd>/clear</kbd></td><td>Clear conversation</td></tr>

                    <tr><th colspan="2" class="llm-input__help-group">Refine</th></tr>
                    <tr><td><kbd>/shorter</kbd> <kbd>/longer</kbd></td><td>Adjust response length</td></tr>
                    <tr><td><kbd>/simplify</kbd></td><td>Simplify last response</td></tr>
                    <tr><td><kbd>/summarize</kbd></td><td>Summarize last response</td></tr>

                    <tr><th colspan="2" class="llm-input__help-group">View</th></tr>
                    <tr><td><kbd>/fold</kbd> <kbd>/foldall</kbd></td><td>Fold current / all messages</td></tr>
                    <tr><td><kbd>/top</kbd> <kbd>/bottom</kbd></td><td>Scroll to top / bottom</td></tr>
                    <tr><td><kbd>/nav</kbd></td><td>Toggle navigation panel</td></tr>

                    <tr><th colspan="2" class="llm-input__help-group">Export</th></tr>
                    <tr><td><kbd>/copy</kbd></td><td>Copy all as Markdown</td></tr>
                    <tr><td><kbd>/export</kbd></td><td>Export conversation</td></tr>

                    <tr><th colspan="2" class="llm-input__help-group">Branch</th></tr>
                    <tr><td><kbd>/branch</kbd></td><td>Create branch</td></tr>
                    <tr><td><kbd>/switch</kbd> &lt;name&gt;</td><td>Switch branch</td></tr>
                    <tr><td><kbd>/branchprev</kbd> <kbd>/branchnext</kbd></td><td>Cycle branches</td></tr>
                    <tr><td><kbd>/branches</kbd></td><td>List all branches</td></tr>

                    <tr><th colspan="2" class="llm-input__help-group">Settings</th></tr>
                    <tr><td><kbd>/agent</kbd> &lt;id&gt;</td><td>Switch agent</td></tr>
                    <tr><td><kbd>/model</kbd> &lt;id&gt;</td><td>Override model</td></tr>
                    <tr><td><kbd>/history</kbd> &lt;n&gt;</td><td>Set context length (0 = none, -1 = all)</td></tr>
                    <tr><td><kbd>/fresh</kbd></td><td>Clear context (fresh start)</td></tr>
                </table>
            </section>

            ${fileSection}
            ${agentSection}

            <p class="llm-input__help-footer">
                Tip: type <kbd>/</kbd> in the input to browse all commands interactively.
            </p>
        `;
    },

    // ================================================================
    // 动态内容渲染
    // ================================================================

    /**
     * 渲染附件列表
     */
    renderAttachments(files: File[]): string {
        return files.map((f, i) => `
            <div class="llm-input__attachment-tag">
                <span class="llm-input__file-icon">${f.type.startsWith('image/') ? '🖼️' : '📄'}</span>
                <span class="llm-input__filename">${escapeHTML(f.name)}</span>
                <span class="llm-input__filesize">(${ChatInputTemplates.formatSize(f.size)})</span>
                <span class="llm-input__remove-btn" data-index="${i}" title="Remove">×</span>
            </div>
        `).join('');
    },

    /**
     * 渲染模型选项
     */
    renderModelOptions(models: ModelOption[], selectedId?: string): string {
        let html = '<option value="">Use Agent Default</option>';

        models.forEach(model => {
            const displayName = model.provider
                ? `${escapeHTML(model.name)} (${escapeHTML(model.provider)})`
                : escapeHTML(model.name);
            const selected = model.id === selectedId ? ' selected' : '';
            html += `<option value="${escapeHTML(model.id)}"${selected}>${displayName}</option>`;
        });

        return html;
    },

    /**
     * 渲染 Agent 选择器选项
     */
    renderExecutorOptions(executors: ExecutorOption[]): string {
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

        if (uncategorized.length > 0) {
            html += uncategorized.map(e => this.renderExecutorOption(e)).join('');
        }

        Object.entries(groups).forEach(([category, items]) => {
            html += `<optgroup label="${escapeHTML(category)}">`;
            html += items.map(e => this.renderExecutorOption(e)).join('');
            html += `</optgroup>`;
        });

        return html;
    },

    /**
     * 渲染单个 Agent 选项
     */
    renderExecutorOption(e: ExecutorOption): string {
        const icon = e.icon ? `${e.icon} ` : '';
        return `<option value="${escapeHTML(e.id)}">${icon}${escapeHTML(e.name)}</option>`;
    },

    // ================================================================
    // 工具方法
    // ================================================================

    formatSize(bytes: number): string {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    },

    // ================================================================
    // SVG 图标
    // ================================================================

    settingsIcon(): string {
        return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>`;
    },

    closeIcon(): string {
        return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>`;
    },

    sliderIcon(): string {
        return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="4" y1="21" x2="4" y2="14"></line>
            <line x1="4" y1="10" x2="4" y2="3"></line>
            <line x1="12" y1="21" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12" y2="3"></line>
            <line x1="20" y1="21" x2="20" y2="16"></line>
            <line x1="20" y1="12" x2="20" y2="3"></line>
            <line x1="1" y1="14" x2="7" y2="14"></line>
            <line x1="9" y1="8" x2="15" y2="8"></line>
            <line x1="17" y1="16" x2="23" y2="16"></line>
        </svg>`;
    },

    attachIcon(): string {
        return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
        </svg>`;
    },

    sendIcon(): string {
        return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
        </svg>`;
    },

    stopIcon(): string {
        return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
        </svg>`;
    },

    helpIcon(): string {
        return `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>`;
    },
};

