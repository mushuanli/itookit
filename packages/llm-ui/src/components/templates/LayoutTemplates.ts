// @file: llm-ui/components/templates/LayoutTemplates.ts
import { escapeHTML } from '@itookit/common';

export const LayoutTemplates = {
    /**
     * 渲染主工作区结构
     */
    renderWorkspace: (currentTitle: string) => `
        <div class="llm-workspace-titlebar">
            <div class="llm-workspace-titlebar__left">
                <button class="llm-workspace-titlebar__btn" id="llm-btn-sidebar" title="Toggle Sidebar">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>
                </button>
                
                <div class="llm-workspace-titlebar__sep"></div>
                
                <input type="text" class="llm-workspace-titlebar__input" id="llm-title-input" value="${escapeHTML(currentTitle)}" placeholder="Untitled Chat" />
            </div>

            <div class="llm-workspace-titlebar__right">
                <button class="llm-workspace-titlebar__btn" id="llm-btn-collapse" title="Collapse/Expand All Messages">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline></svg>
                </button>

                <button class="llm-workspace-titlebar__btn" id="llm-btn-copy" title="Copy as Markdown">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                </button>

                <button class="llm-workspace-titlebar__btn" id="llm-btn-print" title="Print">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                </button>
            </div>
        </div>

        <div class="llm-ui-workspace__history" id="llm-ui-history"></div>
        <div class="llm-ui-workspace__input" id="llm-ui-input"></div>
    `,

    /**
     * 渲染欢迎界面
     */
    renderWelcome: () => `
        <div class="llm-ui-welcome">
            <div class="llm-ui-welcome__icon">👋</div>
            <h2>Ready to chat</h2>
            <p>Send a message to start the conversation</p>
        </div>
    `,

    /**
     * 渲染错误横幅
     */
    renderErrorBanner: (message: string) => `
        <div class="llm-ui-banner llm-ui-banner--error">
            Error: ${escapeHTML(message)}
        </div>
    `
};
