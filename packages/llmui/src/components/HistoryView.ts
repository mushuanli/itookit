// @file: llm-ui/components/HistoryView.ts

import { OrchestratorEvent, SessionGroup, ExecutionNode, NodeAction, NodeActionCallback } from '../core/types';
import { NodeRenderer } from './NodeRenderer';
import { MDxController } from './mdx/MDxController';
import { NodeTemplates } from './templates/NodeTemplates';
import { LayoutTemplates } from './templates/LayoutTemplates';
import { escapeHTML, Modal } from '@itookit/common';

/**
 * ✨ [新增] 包装 common Modal 为 Promise 形式，
 * 以便保持原有代码的 await 逻辑不变。
 */
async function showConfirmDialog(message: string): Promise<boolean> {
    return new Promise((resolve) => {
        new Modal('Confirmation', `<p>${escapeHTML(message)}</p>`, {
            type: 'danger',
            confirmText: 'Delete',
            cancelText: 'Cancel',
            onConfirm: () => resolve(true),
            onCancel: () => resolve(false)
        }).show();
    });
}

async function showEditConfirmDialog(options: {
    title: string;
    message: string;
    options: Array<{ id: string; label: string; primary?: boolean }>;
}): Promise<string> {
    return new Promise((resolve) => {
        const buttonsHtml = options.options.map(opt => 
            `<button class="modal-btn ${opt.primary ? 'modal-btn--primary' : ''}" data-action="${opt.id}">${opt.label}</button>`
        ).join('');
        
        const modal = new Modal(options.title, `
            <p>${options.message}</p>
            <div class="modal-actions">${buttonsHtml}</div>
        `, {
            //showFooter: false,
            onCancel: () => resolve('cancel')
        });
        
        modal.show();
        
        // 绑定按钮事件
        const modalEl = document.querySelector('.modal-content');
        modalEl?.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                resolve((btn as HTMLElement).dataset.action || 'cancel');
                modal.hide();
            });
        });
    });
}

export class HistoryView {
    private nodeMap = new Map<string, HTMLElement>();
    private editorMap = new Map<string, MDxController>();
    private container: HTMLElement;
    
    private shouldAutoScroll = true;
    private scrollThreshold = 50;
    private scrollDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    private onContentChange?: (id: string, content: string, type: 'user' | 'node') => void;
    private onNodeAction?: NodeActionCallback;
    
    // ✨ [新增] 保存原始内容用于取消编辑
    private originalContentMap = new Map<string, string>();
    
    // ✨ [新增] 编辑状态跟踪
    private editingNodes = new Set<string>();

    constructor(
        container: HTMLElement,
        onContentChange?: (id: string, content: string, type: 'user' | 'node') => void,
        onNodeAction?: NodeActionCallback
    ) {
        this.container = container;
        this.onContentChange = onContentChange;
        this.onNodeAction = onNodeAction;

        this.container.addEventListener('scroll', () => {
            const { scrollTop, scrollHeight, clientHeight } = this.container;
            const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
            this.shouldAutoScroll = distanceFromBottom < this.scrollThreshold;
        });
    }

    clear() {
        this.container.innerHTML = '';
        this.nodeMap.clear();
        this.editorMap.forEach(editor => editor.destroy());
        this.editorMap.clear();
        this.originalContentMap.clear();
        this.editingNodes.clear();
    }

    renderFull(sessions: SessionGroup[]) {
        this.clear();
        if (sessions.length === 0) {
            this.renderWelcome();
            return;
        }

        // --- 智能折叠策略 ---
        // 规则：找到最后一条 User 消息，它以及它之后的所有消息保持展开 (Expanded)。
        // 之前的所有消息默认折叠 (Collapsed)。
        let lastUserIndex = -1;
        for (let i = sessions.length - 1; i >= 0; i--) {
            if (sessions[i].role === 'user') {
                lastUserIndex = i;
                break;
            }
        }

        // 如果没有 user 消息（全是 agent?），则默认展开最后一条
        if (lastUserIndex === -1 && sessions.length > 0) {
            lastUserIndex = sessions.length - 1;
        }

        sessions.forEach((session, index) => {
            // 如果 index < lastUserIndex，则折叠 (true)
            // 否则展开 (false)
            const shouldCollapse = index < lastUserIndex;

            this.appendSessionGroup(session, shouldCollapse);
            
            if (session.executionRoot) {
                // Agent 执行树跟随 Session 的折叠状态
                this.renderExecutionTree(session.executionRoot, shouldCollapse);
            }
        });

        this.scrollToBottom(true);
    }

    renderWelcome() {
        this.container.innerHTML = LayoutTemplates.renderWelcome();
    }

    renderError(error: Error) {
        const div = document.createElement('div');
        div.innerHTML = LayoutTemplates.renderErrorBanner(error.message);
        this.container.appendChild(div.firstElementChild!);
        this.scrollToBottom(true);
    }

    processEvent(event: OrchestratorEvent) {
        const forceScroll = event.type === 'session_start' || event.type === 'node_start';

        switch (event.type) {
            case 'session_start':
                // [修复] 新开始的会话始终展开 (isCollapsed = false)
                this.appendSessionGroup(event.payload, false);
                break;
            case 'node_start':
                // [修复] 新开始的节点始终展开 (isCollapsed = false)
                this.appendNode(event.payload.parentId, event.payload.node, false);
                break;
            case 'node_update':
                if (event.payload.chunk !== undefined && event.payload.field !== undefined) {
                    this.updateNodeContent(event.payload.nodeId, event.payload.chunk, event.payload.field);
                }
                break;
            case 'node_status':
                this.updateNodeStatus(event.payload.nodeId, event.payload.status, event.payload.result);
                break;
            case 'finished':
                this.editorMap.forEach(editor => editor.finishStream());
                break;
        case 'error':
            this.renderError(new Error(event.payload.message));
            break;
            // ✨ [新增] 处理删除事件
            case 'messages_deleted':
            this.handleMessagesDeleted(event.payload.deletedIds);
                break;
            // ✨ [新增] 处理编辑事件
            case 'message_edited':
            this.handleMessageEdited(event.payload.sessionId, event.payload.newContent);
                break;
            // ✨ [新增] 处理会话清空
            case 'session_cleared':
                this.renderWelcome();
                break;
            // ✨ [新增] 处理分支切换
            case 'sibling_switch':
            this.handleSiblingSwitch(event.payload);
                break;
        case 'retry_started':
            // 可选：显示重试中的提示
            console.log('[HistoryView] Retry started:', event.payload);
            break;
        case 'request_input':
            // 处理输入请求（如果需要）
            console.log('[HistoryView] Input requested:', event.payload);
            break;
        }

        this.scrollToBottom(forceScroll);
    }

    private appendSessionGroup(group: SessionGroup, isCollapsed: boolean) {
        const wrapper = document.createElement('div');
        wrapper.className = `llm-ui-session llm-ui-session--${group.role}`;
        wrapper.dataset.sessionId = group.id;

        if (group.role === 'user') {
            const preview = this.getPreviewText(group.content || '');
            // 传入 isCollapsed
            wrapper.innerHTML = NodeTemplates.renderUserBubble(group, preview, isCollapsed);
            this.container.appendChild(wrapper);
            
            // 只有当未折叠时，才立即初始化编辑器 (懒加载优化)
            // 或者：总是初始化，但在 CSS 中隐藏。为了兼容搜索，通常需要初始化。
            // 这里为了简单，我们总是初始化，依赖 CSS display:none 隐藏
            this.initUserBubble(wrapper, group);
        } else {
            wrapper.innerHTML = `
                <div class="llm-ui-avatar">🤖</div>
                <div class="llm-ui-execution-root" id="container-${group.id}"></div>
            `;
            this.container.appendChild(wrapper);
        }
    }

    private initUserBubble(wrapper: HTMLElement, group: SessionGroup) {
        const mountPoint = wrapper.querySelector(`#user-mount-${group.id}`) as HTMLElement;
        const controller = new MDxController(mountPoint, group.content || '', {
            readOnly: true,
            onChange: (text) => {
                this.onContentChange?.(group.id, text, 'user');
                const previewEl = wrapper.querySelector('.llm-ui-header-preview');
                if (previewEl) previewEl.textContent = this.getPreviewText(text);
            }
        });
        this.editorMap.set(group.id, controller);

        // 绑定事件
        this.bindUserBubbleEvents(wrapper, group, controller);
    }

    private bindUserBubbleEvents(wrapper: HTMLElement, group: SessionGroup, controller: MDxController) {
        const bubbleEl = wrapper.querySelector('.llm-ui-bubble--user') as HTMLElement;
        const editActionsEl = wrapper.querySelector('.llm-ui-edit-actions') as HTMLElement;
    if (!bubbleEl) {
        console.error('[HistoryView] bubbleEl not found for group:', group.id);
        return;
    }

        // Retry (Resend)
        wrapper.querySelector('[data-action="retry"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.onNodeAction?.('resend', group.id);
        });

        // Edit
        wrapper.querySelector('[data-action="edit"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleEditMode(group.id, controller, editActionsEl, wrapper);
        });

        // Copy
        wrapper.querySelector('[data-action="copy"]')?.addEventListener('click', async (e) => {
            e.stopPropagation();
        await this.handleCopy(controller.content, e.currentTarget as HTMLElement);
        });

        // Delete
        wrapper.querySelector('[data-action="delete"]')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            await this.handleDeleteConfirm(group.id, 'user');
        });

    // ✅ 修复：Collapse 使用 currentTarget
    const collapseBtn = wrapper.querySelector('[data-action="collapse"]');
    if (collapseBtn) {
        collapseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const btn = e.currentTarget as HTMLElement;
            console.log('[DEBUG] User bubble collapse clicked');
            console.log('[DEBUG] bubbleEl:', bubbleEl);
            console.log('[DEBUG] btn:', btn);
            this.toggleCollapse(bubbleEl, btn);
        });
    } else {
        console.warn('[HistoryView] Collapse button not found for group:', group.id);
    }

        // 分支导航
        wrapper.querySelector('[data-action="prev-sibling"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.onNodeAction?.('prev-sibling', group.id);
        });

        wrapper.querySelector('[data-action="next-sibling"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.onNodeAction?.('next-sibling', group.id);
        });

        // 编辑确认按钮
        wrapper.querySelector('[data-action="confirm-edit"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.confirmEdit(group.id, controller, editActionsEl, wrapper, true);
        });

        wrapper.querySelector('[data-action="save-only"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.confirmEdit(group.id, controller, editActionsEl, wrapper, false);
        });

        wrapper.querySelector('[data-action="cancel-edit"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.cancelEdit(group.id, controller, editActionsEl, wrapper);
        });
    }

    private toggleEditMode(nodeId: string, controller: MDxController, actionsEl: HTMLElement, wrapper: HTMLElement) {
        if (!this.editingNodes.has(nodeId)) {
            // Enter Edit
            this.originalContentMap.set(nodeId, controller.content);
            this.editingNodes.add(nodeId);
            controller.toggleEdit();
            actionsEl.style.display = 'flex';
            wrapper.querySelector('[data-action="edit"]')?.classList.add('active');
            
            // 如果是折叠状态，先展开以便编辑
            const bubble = wrapper.querySelector('.llm-ui-bubble--user');
            if (bubble && bubble.classList.contains('is-collapsed')) {
                // 模拟点击折叠按钮
                const collapseBtn = wrapper.querySelector('[data-action="collapse"]');
                if (collapseBtn) (collapseBtn as HTMLElement).click();
            }
        } else {
            // Cancel Edit
            this.cancelEdit(nodeId, controller, actionsEl, wrapper);
        }
    }

    private confirmEdit(
        nodeId: string,
        controller: MDxController,
        editActionsEl: HTMLElement,
        wrapper: HTMLElement,
        regenerate: boolean
    ) {
    // 获取编辑后的内容
    const newContent = controller.content;
        // 退出编辑模式
        this.editingNodes.delete(nodeId);
        this.originalContentMap.delete(nodeId);
        controller.toggleEdit();
        editActionsEl.style.display = 'none';
        wrapper.querySelector('[data-action="edit"]')?.classList.remove('active');

    // ✅ 关键修复：无论是否重新生成，都先保存内容
    this.onContentChange?.(nodeId, newContent, 'user');
        // 通知外部
        if (regenerate) {
            this.onNodeAction?.('edit-and-retry', nodeId);
        }
    }

    private cancelEdit(
        nodeId: string,
        controller: MDxController,
        editActionsEl: HTMLElement,
        wrapper: HTMLElement
    ) {
        // 恢复原始内容
        const originalContent = this.originalContentMap.get(nodeId);
        if (originalContent !== undefined) {
            // 需要在 MDxController 中添加 setContent 方法
            (controller as any).currentContent = originalContent;
            controller.finishStream(); // 触发重新渲染
        }

        this.editingNodes.delete(nodeId);
        this.originalContentMap.delete(nodeId);
        controller.toggleEdit();
        editActionsEl.style.display = 'none';
        wrapper.querySelector('[data-action="edit"]')?.classList.remove('active');
    }

    private async handleCopy(content: string, btnElement: HTMLElement) {
        try {
            await navigator.clipboard.writeText(content);
            const originalHtml = btnElement.innerHTML;
            btnElement.innerHTML = '✓';
            setTimeout(() => btnElement.innerHTML = originalHtml, 1500);
        } catch (err) {
            console.error('Copy failed', err);
        }
    }

    private async handleDeleteConfirm(nodeId: string, type: 'user' | 'assistant') {
        let message = 'Delete this message?';
        
        if (type === 'user') {
            const associatedCount = this.countAssociatedResponses(nodeId);
            if (associatedCount > 0) {
                message = `Delete this message and ${associatedCount} response(s)?`;
            }
        }

        const confirmed = await showConfirmDialog(message);
        if (confirmed) {
            this.onNodeAction?.('delete', nodeId);
        }
    }

    private countAssociatedResponses(userNodeId: string): number {
        const sessions = this.container.querySelectorAll('.llm-ui-session');
        let count = 0;
        let foundUser = false;

        sessions.forEach(session => {
            const sessionId = (session as HTMLElement).dataset.sessionId;
            if (sessionId === userNodeId) {
                foundUser = true;
                return;
            }
            if (foundUser) {
                if (session.classList.contains('llm-ui-session--assistant')) {
                    count++;
                } else {
                    foundUser = false; // 遇到下一个 user，停止计数
                }
            }
        });

        return count;
    }

    private toggleCollapse(element: HTMLElement, btn: HTMLElement) {
    console.log('[DEBUG] toggleCollapse called');
    console.log('[DEBUG] Element classList before:', element.classList.toString());
        element.classList.toggle('is-collapsed');
    
    const isCollapsed = element.classList.contains('is-collapsed');
    console.log('[DEBUG] Is now collapsed:', isCollapsed);
    
    // 检查预览元素
    const previewEl = element.querySelector('.llm-ui-header-preview');
    if (previewEl) {
        console.log('[DEBUG] Preview element found, content:', previewEl.textContent);
        // 强制检查 computed style
        const computedStyle = window.getComputedStyle(previewEl);
        console.log('[DEBUG] Preview display:', computedStyle.display);
    } else {
        console.warn('[DEBUG] Preview element NOT found!');
    }
    
    // 更新 SVG 图标
    const svg = btn.querySelector('svg');
    if (!svg) {
        console.warn('[DEBUG] SVG not found in button:', btn.innerHTML);
        return;
    }

    if (isCollapsed) {
        svg.innerHTML = '<polyline points="6 9 12 15 18 9"></polyline>';
    } else {
        svg.innerHTML = '<polyline points="18 15 12 9 6 15"></polyline>';
    }
    
    console.log('[DEBUG] Toggle complete');
    }

    /**
     * 递归渲染执行树
     */
    private renderExecutionTree(node: ExecutionNode, isCollapsed: boolean = false) {
        this.appendNode(node.parentId, node, isCollapsed);
        node.children?.forEach(c => this.renderExecutionTree(c, isCollapsed));
    }

    /**
     * 添加执行节点 DOM
     * [修改] 接受 isCollapsed 参数
     */
    private appendNode(parentId: string | undefined, node: ExecutionNode, isCollapsed: boolean) {
        let parentEl: HTMLElement | null = null;
        
        if (parentId) {
            parentEl = this.nodeMap.get(parentId)?.querySelector('.llm-ui-node__children') || null;
        }
        
        if (!parentEl) {
            const roots = this.container.querySelectorAll('.llm-ui-execution-root');
            if (roots.length > 0) parentEl = roots[roots.length - 1] as HTMLElement;
        }

        if (parentEl) {
            // 需要修改 NodeRenderer.create 接口以接受 isCollapsed
            // 或者手动添加 class
            const { element, mountPoints } = NodeRenderer.create(node);
            
            if (isCollapsed) {
                element.classList.add('is-collapsed');
                // 更新 SVG 图标
                const svg = element.querySelector('[data-action="collapse"] svg');
                if (svg) svg.innerHTML = '<polyline points="6 9 12 15 18 9"></polyline>';
            }

            this.nodeMap.set(node.id, element);
            parentEl.appendChild(element);

            this.bindNodeEvents(element, node, mountPoints);
        }
    }

    private bindNodeEvents(element: HTMLElement, node: ExecutionNode, mountPoints: any) {
        const editBtn = element.querySelector('[data-action="edit"]');
        const copyBtn = element.querySelector('[data-action="copy"]');
        const collapseBtn = element.querySelector('[data-action="collapse"]');
        const retryBtn = element.querySelector('[data-action="retry"]');
        const deleteBtn = element.querySelector('[data-action="delete"]');

    // ✨ [关键] 找到这个节点所属的 SessionGroup
    const getSessionId = (): string => {
        const sessionEl = element.closest('[data-session-id]');
        return (sessionEl as HTMLElement)?.dataset.sessionId || node.id;
    };
    
    const effectiveId = getSessionId();

        // Retry
        retryBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.onNodeAction?.('retry', effectiveId);
        });

        // Delete
        deleteBtn?.addEventListener('click', async (e) => {
            e.stopPropagation();
            await this.handleDeleteConfirm(effectiveId, 'assistant');
        });

        // Collapse
        collapseBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleCollapse(element, e.target as HTMLElement);
        });

        // 分支导航
        element.querySelector('[data-action="prev-sibling"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.onNodeAction?.('prev-sibling', node.id);
        });

        element.querySelector('[data-action="next-sibling"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.onNodeAction?.('next-sibling', node.id);
        });

        // 初始化内容编辑器
        if (mountPoints.output) {
            const controller = new MDxController(mountPoints.output, node.data.output || '', {
                readOnly: true,
                onChange: (text) => {
                    this.onContentChange?.(effectiveId, text, 'node');
                    const previewEl = element.querySelector('.llm-ui-header-preview');
                    if (previewEl) previewEl.textContent = this.getPreviewText(text);
                }
            });
            this.editorMap.set(node.id, controller);

            editBtn?.addEventListener('click', () => {
                controller.toggleEdit();
                editBtn.classList.toggle('active');
            });

            copyBtn?.addEventListener('click', async () => {
                await this.handleCopy(controller.content, copyBtn as HTMLElement);
            });
        } else {
            if (editBtn) (editBtn as HTMLButtonElement).style.display = 'none';
            if (copyBtn) (copyBtn as HTMLButtonElement).style.display = 'none';
        }
    }

    private updateNodeContent(nodeId: string, chunk: string, field: 'thought' | 'output') {
        const el = this.nodeMap.get(nodeId);
        if (!el) return;

        if (field === 'thought') {
            const container = el.querySelector('.llm-ui-thought') as HTMLElement;
            const contentEl = el.querySelector('.llm-ui-thought__content') as HTMLElement;

            if (container && container.style.display === 'none') {
                container.style.display = 'block';
            }
            if (contentEl) {
                contentEl.innerHTML += escapeHTML(chunk).replace(/\n/g, '<br>');
                if (container) container.scrollTop = container.scrollHeight;
            }
        } else if (field === 'output') {
            const editor = this.editorMap.get(nodeId);
            if (editor) {
                editor.appendStream(chunk);
                const previewEl = el.querySelector('.llm-ui-header-preview');
                if (previewEl) {
                    previewEl.textContent = this.getPreviewText(editor.content);
                }
            }
        }
    }

    private updateNodeStatus(nodeId: string, status: string, result?: any) {
        const el = this.nodeMap.get(nodeId);
        if (el) {
            el.dataset.status = status;
            el.classList.remove('llm-ui-node--running', 'llm-ui-node--success', 'llm-ui-node--failed');
            el.classList.add(`llm-ui-node--${status}`);

            const statusText = el.querySelector('.llm-ui-node__status');
            if (statusText) {
                statusText.textContent = status;
                statusText.className = `llm-ui-node__status llm-ui-node__status--${status}`;
            }

            if (result && el.classList.contains('llm-ui-node--tool')) {
                const resEl = el.querySelector('.llm-ui-node__result') as HTMLElement;
                if (resEl) {
                    resEl.style.display = 'block';
                    resEl.textContent = typeof result === 'string' ? result : JSON.stringify(result);
                }
            }
        }

        const editor = this.editorMap.get(nodeId);
        if (editor && (status === 'success' || status === 'failed')) {
            // [修复] 传入 false，表示这是流式传输结束，不是用户手动编辑
            // 这样就不会触发 SessionManager.editMessage -> 抛出 ID 错误
            editor.finishStream(false);
        }
    }

    // ✨ [新增] 处理消息删除
    private handleMessagesDeleted(deletedIds: string[]) {
        for (const id of deletedIds) {
            // 从 DOM 中移除
            const sessionEl = this.container.querySelector(`[data-session-id="${id}"]`);
            if (sessionEl) {
                sessionEl.classList.add('llm-ui-session--deleting');
                setTimeout(() => sessionEl.remove(), 300);
            }

            // 清理编辑器
            const editor = this.editorMap.get(id);
            if (editor) {
                editor.destroy();
                this.editorMap.delete(id);
            }

            // 清理节点映射
            this.nodeMap.delete(id);
            this.originalContentMap.delete(id);
            this.editingNodes.delete(id);
        }

        // 检查是否需要显示欢迎界面
        const remainingSessions = this.container.querySelectorAll('.llm-ui-session');
        if (remainingSessions.length === 0) {
            this.renderWelcome();
        }
    }

    // ✨ [新增] 处理消息编辑
    private handleMessageEdited(sessionId: string, newContent: string) {
        const sessionEl = this.container.querySelector(`[data-session-id="${sessionId}"]`);
        if (sessionEl) {
            const previewEl = sessionEl.querySelector('.llm-ui-header-preview');
            if (previewEl) {
                previewEl.textContent = this.getPreviewText(newContent);
            }
        }
    }

    // ✨ [新增] 处理分支切换
    private handleSiblingSwitch(payload: { sessionId: string; newIndex: number; total: number }) {
        const sessionEl = this.container.querySelector(`[data-session-id="${payload.sessionId}"]`);
        if (!sessionEl) return;

        // 更新分支导航显示
        const indicator = sessionEl.querySelector('.llm-ui-branch-indicator');
        if (indicator) {
            indicator.textContent = `${payload.newIndex + 1}/${payload.total}`;
        }

        // 更新按钮禁用状态
        const prevBtn = sessionEl.querySelector('[data-action="prev-sibling"]') as HTMLButtonElement;
        const nextBtn = sessionEl.querySelector('[data-action="next-sibling"]') as HTMLButtonElement;

        if (prevBtn) prevBtn.disabled = payload.newIndex === 0;
        if (nextBtn) nextBtn.disabled = payload.newIndex === payload.total - 1;

        // 刷新内容（如果需要的话，由 SessionManager 处理）
    }

    scrollToBottom(force: boolean = false) {
        if (force || this.shouldAutoScroll) {
            if (this.scrollDebounceTimer) {
                clearTimeout(this.scrollDebounceTimer);
            }

            this.scrollDebounceTimer = setTimeout(() => {
                requestAnimationFrame(() => {
                    this.container.scrollTop = this.container.scrollHeight;
                });
            }, 16); // 约一帧的时间
        }
    }

    // [新增] 辅助：截取预览文本
    private getPreviewText(content: string): string {
        if (!content) return '';
        // 1. 替换换行为空格
        let plain = content.replace(/[\r\n]+/g, ' ');
        // 2. 移除常见的 Markdown 符号
        plain = plain.replace(/[*#`_~[\]()]/g, '');
    plain = plain.trim();
    if (!plain) return '';  // ← 添加默认值
        // 3. 截断
        return plain.length > 60 ? plain.substring(0, 60) + '...' : plain;
    }

    // ✨ [新增] 销毁方法
    destroy() {
        if (this.scrollDebounceTimer) {
            clearTimeout(this.scrollDebounceTimer);
        }
        this.clear();
    }
}
