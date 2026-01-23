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
                
                <!-- 状态指示器 -->
                <div class="llm-workspace-status" id="llm-status-indicator">
                    <span class="llm-workspace-status__dot"></span>
                    <span class="llm-workspace-status__text">Ready</span>
                </div>
            </div>

            <div class="llm-workspace-titlebar__right">
                <!-- 后台运行指示器 -->
                <div class="llm-workspace-titlebar__bg-indicator" id="llm-bg-indicator" style="display:none;">
                    <span class="llm-bg-badge">2 running</span>
                </div>

                <!-- ✨ [新增] 4个新按钮组 -->
                <button class="llm-workspace-titlebar__btn" id="llm-btn-prev-agent" title="Prev Agent Chat">
                   <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
                </button>
                
                <button class="llm-workspace-titlebar__btn" id="llm-btn-next-agent" title="Next Agent Chat">
                   <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
                </button>

                <div class="llm-workspace-titlebar__sep"></div>

                <button class="llm-workspace-titlebar__btn" id="llm-btn-fold-one" title="Fold First Unfolded">
                   <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 14h6m-6 4h6m8-10h-6m6-4h-6M4 6h6m-3-3v18"/></svg>
                </button>

                <button class="llm-workspace-titlebar__btn" id="llm-btn-copy-agent" title="Copy First Unfolded Agent">
                   <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                </button>
                
                <div class="llm-workspace-titlebar__sep"></div>
                <!-- ✨ [新增结束] -->

                <!-- 原有按钮 -->
                <button class="llm-workspace-titlebar__btn" id="llm-btn-assets" title="附件管理">
                    <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                        <path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5a2.5 2.5 0 0 0 5 0V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"/>
                    </svg>
                </button>

                <button class="llm-workspace-titlebar__btn" id="llm-btn-collapse" title="Collapse/Expand All Messages">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline></svg>
                </button>

                <button class="llm-workspace-titlebar__btn" id="llm-btn-copy" title="Copy as Markdown">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                </button>

                <button class="llm-workspace-titlebar__btn" id="llm-btn-navigator" title="Chat Navigator (Ctrl+G)">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                            <line x1="3" y1="12" x2="21" y2="12"></line>
                            <line x1="3" y1="6" x2="21" y2="6"></line>
                            <line x1="3" y1="18" x2="21" y2="18"></line>
                            <circle cx="9" cy="12" r="2" fill="currentColor"></circle>
                        </svg>
                </button>

                <button class="llm-workspace-titlebar__btn" id="llm-btn-print" title="Print">
                        <i class="fas fa-print"></i>
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
