// @file llm-ui/components/templates/NodeTemplates.ts
import { escapeHTML } from '@itookit/common';
import { ExecutionNode, SessionGroup } from '../../core/types';

export const NodeTemplates = {
    /**
     * 渲染 Agent 节点的头部
     */
    renderAgentHeader: (node: ExecutionNode, previewText: string) => `
        <div class="llm-ui-node__header">
            <span class="llm-ui-node__icon">${node.icon || '🤖'}</span>
            
            <span class="llm-ui-node__title">${escapeHTML(node.name || 'Assistant')}</span>
            
            <span class="llm-ui-header-preview">${escapeHTML(previewText)}</span>
            
            <div style="flex:1"></div>

            <div class="llm-ui-node__status llm-ui-node__status--${node.status}">${node.status}</div>
            
            <div class="llm-ui-node__toolbar">
                ${_btn('retry', 'Regenerate', `<path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>`)}
                ${_btn('edit', 'Edit Mode', `<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>`)}
                ${_btn('copy', 'Copy Content', `<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>`)}
                ${_btn('delete', 'Delete', `<polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>`, 'var(--llm-ui-color-error)')}
                ${_btn('collapse', 'Collapse/Expand', `<polyline points="18 15 12 9 6 15"></polyline>`)}
            </div>
        </div>
    `,

    /**
     * 渲染思维链区域
     */
    renderThinking: (thought: string, isOpen: boolean) => `
        <details class="llm-ui-thought" ${isOpen ? 'open' : ''} style="${isOpen ? 'display:block' : 'display:none'}">
            <summary class="llm-ui-thought__summary">
                <span>💭 Thinking Process</span>
            </summary>
            <div class="llm-ui-thought__content">${escapeHTML(thought)}</div>
        </details>
    `,

    /**
     * 渲染工具节点
     */
    renderTool: (node: ExecutionNode) => `
        <div class="llm-ui-node__header">
            <span class="llm-ui-node__icon">🔧</span>
            <span class="llm-ui-node__title">${escapeHTML(node.name)}</span>
            <span class="llm-ui-header-preview">Tool Call...</span>
            <div style="flex:1"></div>
            <span class="llm-ui-node__status llm-ui-node__status--${node.status}">${node.status}</span>
            <div class="llm-ui-node__toolbar">
                 ${_btn('delete', 'Delete', `<polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>`)}
            </div>
        </div>
        <div class="llm-ui-node__body">
            <div class="llm-ui-node__args"><code>${escapeHTML(JSON.stringify(node.data.toolCall?.args || {}))}</code></div>
            <div class="llm-ui-node__result"></div>
        </div>
    `,

    /**
     * 渲染用户消息气泡
     */
    renderUserBubble: (group: SessionGroup, contentPreview: string) => {
        const hasSiblings = (group.siblingCount ?? 1) > 1;
        const siblingIndex = group.siblingIndex ?? 0;
        const siblingCount = group.siblingCount ?? 1;

        return `
            <div class="llm-ui-avatar">👤</div>
            <div class="llm-ui-bubble--user">
                <div class="llm-ui-bubble__header">
                    <span class="llm-ui-bubble__title">You</span>
                    <span class="llm-ui-header-preview">${escapeHTML(contentPreview)}</span>
                    <div style="flex:1"></div>

                    ${hasSiblings ? `
                        <div class="llm-ui-branch-nav">
                            <button class="llm-ui-branch-btn" data-action="prev-sibling" 
                                    ${siblingIndex === 0 ? 'disabled' : ''} title="Previous version">
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="15 18 9 12 15 6"></polyline>
                                </svg>
                            </button>
                            <span class="llm-ui-branch-indicator">${siblingIndex + 1}/${siblingCount}</span>
                            <button class="llm-ui-branch-btn" data-action="next-sibling"
                                    ${siblingIndex === siblingCount - 1 ? 'disabled' : ''} title="Next version">
                                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                                    <polyline points="9 18 15 12 9 6"></polyline>
                                </svg>
                            </button>
                        </div>
                    ` : ''}

                    <div class="llm-ui-bubble__toolbar">
                        ${_btn('retry', 'Resend', `<path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>`, '', 'llm-ui-btn-bubble-tool')}
                        ${_btn('edit', 'Edit', `<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>`, '', 'llm-ui-btn-bubble-tool')}
                        ${_btn('copy', 'Copy', `<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>`, '', 'llm-ui-btn-bubble-tool')}
                        ${_btn('delete', 'Delete', `<polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>`, '', 'llm-ui-btn-bubble-tool')}
                        ${_btn('collapse', 'Collapse', `<polyline points="18 15 12 9 6 15"></polyline>`, '', 'llm-ui-btn-bubble-tool')}
                    </div>
                </div>
                <div class="llm-ui-bubble__body">
                    <div class="llm-ui-mount-point" id="user-mount-${group.id}"></div>
                    
                    <div class="llm-ui-edit-actions" style="display:none;">
                        <button class="llm-ui-btn llm-ui-btn--primary" data-action="confirm-edit">Save & Regenerate</button>
                        <button class="llm-ui-btn llm-ui-btn--secondary" data-action="save-only">Save Only</button>
                        <button class="llm-ui-btn llm-ui-btn--ghost" data-action="cancel-edit">Cancel</button>
                    </div>
                </div>
            </div>
        `;
    }
};

/**
 * 辅助函数：生成工具栏按钮 HTML
 */
function _btn(action: string, title: string, iconSvgContent: string, color?: string, className: string = 'llm-ui-btn-tool') {
    const style = color ? `style="color:${color}"` : '';
    return `
        <button class="${className}" data-action="${action}" title="${title}" ${style}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                ${iconSvgContent}
            </svg>
        </button>
    `;
}
