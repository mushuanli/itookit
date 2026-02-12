// @file: llm-ui/components/templates/ErrorTemplates.ts

import { escapeHTML } from '@itookit/common';

export class ErrorTemplates {
    /**
     * 渲染错误横幅
     */
    static renderErrorBanner(message: string): string {
        return `
            <div class="llm-ui-error-banner__content">
                <span class="llm-ui-error-banner__icon">⚠️</span>
                <span class="llm-ui-error-banner__message">${escapeHTML(message)}</span>
                <button class="llm-ui-error-banner__close" title="Dismiss">×</button>
            </div>
        `;
    }

    /**
     * 渲染新内容提示器
     */
    static renderNewContentIndicator(): string {
        return `
            <button class="llm-ui-new-content-btn">
                <span>⬇️ New response available</span>
            </button>
        `;
    }

    /**
     * 渲染错误气泡
     */
    static renderErrorBubble(message: string, showSettings: boolean): string {
        let actionButtons = '';

        if (showSettings) {
            actionButtons += `
                <button class="llm-ui-error-btn" data-action="open-settings">⚙️ 配置连接</button>
            `;
        }

        actionButtons += `
            <button class="llm-ui-error-btn" data-action="retry-last">↻ 重试</button>
        `;

        return `
            <div class="llm-ui-bubble llm-ui-bubble--error">
                <strong>⚠️ 执行失败</strong>
                <div class="llm-ui-bubble--error__content">
                    ${escapeHTML(message)}
                </div>
                <div class="llm-ui-bubble--error__actions">
                    ${actionButtons}
                </div>
            </div>
        `;
    }

    /**
     * 渲染分支通知
     */
    static renderBranchNotification(message: string): string {
        return escapeHTML(message);
    }
}
