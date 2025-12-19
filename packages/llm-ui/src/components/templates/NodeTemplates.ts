// @file: llm-ui/components/templates/NodeTemplates.ts

import { ExecutionNode, SessionGroup } from '@itookit/llm-engine';
import { escapeHTML } from '@itookit/common';

export class NodeTemplates {
    /**
     * 格式化时间显示
     */
    private static formatTime(timestamp: number): string {
        return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    static renderUserBubble(group: SessionGroup, preview: string, isCollapsed: boolean = false): string {
        const fileBadges = (group.files || []).map(f => 
            `<span class="llm-ui-file-badge">📄 ${escapeHTML(f.name)}</span>`
        ).join('');

        const collapsedClass = isCollapsed ? 'is-collapsed' : '';
        const timeStr = this.formatTime(group.timestamp);

    // ✅ 修复：只有多分支时才显示导航器
    const hasSiblings = (group.siblingCount ?? 1) > 1;
    const siblingIndex = group.siblingIndex ?? 0;
    const siblingCount = group.siblingCount ?? 1;
    
    const branchNavHtml = hasSiblings ? `
        <button class="llm-icon-btn" data-action="prev-sibling" title="Previous" ${siblingIndex === 0 ? 'disabled' : ''}>←</button>
        <span class="llm-ui-branch-indicator">${siblingIndex + 1}/${siblingCount}</span>
        <button class="llm-icon-btn" data-action="next-sibling" title="Next" ${siblingIndex === siblingCount - 1 ? 'disabled' : ''}>→</button>
        <div class="llm-ui-sep" style="width:1px;background:rgba(255,255,255,0.2);margin:0 4px;"></div>
    ` : '';
        return `
            <div class="llm-ui-bubble llm-ui-bubble--user ${collapsedClass}">
                <div class="llm-ui-bubble__header">
                    <div class="llm-ui-avatar">👤</div>
                    
                    <div class="llm-ui-header-preview">${escapeHTML(preview)}</div>
                    <div class="llm-ui-time">${timeStr}</div>

                    <!-- 使用 margin-left: auto 将 actions 推到右边 -->
                    <div class="llm-ui-actions" style="margin-left: auto; display: flex; gap: 4px;">
                     ${branchNavHtml}
                     
                         
                         <button class="llm-icon-btn" data-action="delete" title="Delete">🗑️</button>
                         <button class="llm-icon-btn" data-action="retry" title="Resend">↻</button>
                         <button class="llm-icon-btn" data-action="edit" title="Edit">✎</button>
                         <button class="llm-icon-btn" data-action="copy" title="Copy">📋</button>
                         <button class="llm-icon-btn" data-action="collapse" title="Toggle">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                                ${isCollapsed 
                                    ? '<polyline points="6 9 12 15 18 9"></polyline>' 
                                    : '<polyline points="18 15 12 9 6 15"></polyline>'}
                            </svg>
                         </button>
                    </div>
                </div>
                <div class="llm-ui-bubble__content">
                    ${fileBadges ? `<div class="llm-ui-files">${fileBadges}</div>` : ''}
                    <div class="llm-ui-mount-point" id="user-mount-${group.id}"></div>
                    
                    <div class="llm-ui-edit-actions" style="display:none;">
                        <button class="llm-btn llm-btn--primary" data-action="confirm-edit">Save & Run</button>
                        <button class="llm-btn" data-action="save-only">Save Only</button>
                        <button class="llm-btn" data-action="cancel-edit">Cancel</button>
                    </div>
                </div>
            </div>
        `;
    }

    static renderAgentHeader(node: ExecutionNode, preview: string, icon: string, isCollapsed: boolean = false): string {
        const timeStr = this.formatTime(node.startTime);
        
        return `
            <div class="llm-ui-node__header">
                <div class="llm-ui-node__status-icon">
                    <div class="llm-ui-spinner"></div>
                    <div class="llm-ui-status-dot"></div>
                </div>
                <div class="llm-ui-node__icon">${icon}</div>
                <div class="llm-ui-node__title">${escapeHTML(node.name)}</div>
                
                <div class="llm-ui-header-preview">${escapeHTML(preview)}</div>
                
                <div class="llm-ui-node__meta">
                    <span class="llm-ui-time">${timeStr}</span>
                    <span class="llm-ui-node__status">${node.status}</span>
                </div>

                <!-- 使用 margin-left: auto 将 actions 推到右边 -->
                <div class="llm-ui-actions" style="margin-left: auto; display: flex; gap: 4px;">
                    <button class="llm-icon-btn" data-action="delete" title="Delete">🗑️</button>
                    <!-- 新增 Edit 按钮 (用于修改输出结果) -->
                    <button class="llm-icon-btn" data-action="retry" title="Retry">↻</button>
                    <button class="llm-icon-btn" data-action="edit" title="Edit Result">✎</button>
                    <button class="llm-icon-btn" data-action="copy" title="Copy">📋</button>
                    <button class="llm-icon-btn" data-action="collapse" title="Toggle">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                            ${isCollapsed 
                                ? '<polyline points="6 9 12 15 18 9"></polyline>' 
                                : '<polyline points="18 15 12 9 6 15"></polyline>'}
                        </svg>
                    </button>
                </div>
            </div>
        `;
    }

    static renderThinking(thought: string, visible: boolean): string {
        const displayStyle = visible ? 'block' : 'none';
        return `
            <div class="llm-ui-thought" style="display: ${displayStyle}">
                <div class="llm-ui-thought__label">Thinking Process</div>
                <div class="llm-ui-thought__content">${escapeHTML(thought).replace(/\n/g, '<br>')}</div>
            </div>
        `;
    }

    // [修改] 增加 icon 参数
    static renderTool(node: ExecutionNode, icon: string): string {
        const inputStr = JSON.stringify(node.data.input || {}, null, 2);
        const resultStr = JSON.stringify(node.data.toolCall?.result || {}, null, 2);

        return `
            <div class="llm-ui-node__header">
                <div class="llm-ui-node__icon">${icon}</div>
                <div class="llm-ui-node__title">${escapeHTML(node.name)}</div>
                <div class="llm-ui-node__status">${node.status}</div>
                <div class="llm-ui-actions">
                    <button class="llm-icon-btn" data-action="collapse">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="18 15 12 9 6 15"></polyline>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="llm-ui-node__body">
                <div class="llm-ui-code-block">Input: ${escapeHTML(inputStr)}</div>
                <div class="llm-ui-code-block llm-ui-node__result" style="display:${node.status === 'success' ? 'block' : 'none'}">
                    Result: ${escapeHTML(resultStr)}
                </div>
            </div>
        `;
    }
}
