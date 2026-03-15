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
            <div class="llm-input__settings-panel" style="display: none;">
                <div class="llm-input__settings-header">
                    <span class="llm-input__settings-title">
                        ${this.settingsIcon()}
                        Chat Settings
                    </span>
                    <button class="llm-input__settings-close" title="Close settings">
                        ${this.closeIcon()}
                    </button>
                </div>
                
                <div class="llm-input__settings-body">
                    ${this.renderModelSetting()}
                    ${this.renderStreamSetting()}
                    ${this.renderHistorySetting()}
                    ${this.renderPresets()}
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
                    Model Override
                </label>
                <select class="llm-input__model-select" title="Override model for this chat">
                    <option value="">Use Agent Default</option>
                </select>
                <span class="llm-input__setting-hint">Temporarily use a different model</span>
            </div>
        `;
    },

    /**
     * 流式模式设置行
     */
    renderStreamSetting(): string {
        return `
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
        `;
    },

    /**
     * 历史上下文设置行
     */
    renderHistorySetting(): string {
        return `
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
        `;
    },

    /**
     * 快速预设按钮
     */
    renderPresets(): string {
        return `
            <div class="llm-input__setting-row llm-input__presets">
                <span class="llm-input__setting-label">Quick presets:</span>
                <div class="llm-input__preset-buttons">
                    <button class="llm-input__preset-btn" data-history="0" title="No history context">Fresh Start</button>
                    <button class="llm-input__preset-btn" data-history="5" title="Last 5 messages">Short (5)</button>
                    <button class="llm-input__preset-btn" data-history="20" title="Last 20 messages">Medium (20)</button>
                    <button class="llm-input__preset-btn active" data-history="-1" title="All messages">Full</button>
                </div>
            </div>
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
};

