// @file llm-ui/components/HistoryView.ts
import { OrchestratorEvent, SessionGroup, ExecutionNode,NodeAction, NodeActionCallback } from '../types';
import { NodeRenderer } from './NodeRenderer';
import { MDxController } from './mdx/MDxController';
// ✨ [修改] 引入 Modal
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
        sessions.forEach(session => {
            this.appendSessionGroup(session);
            if (session.executionRoot) {
                this.renderExecutionTree(session.executionRoot);
            }
        });
        this.scrollToBottom(true);
    }

    renderWelcome() {
        this.container.innerHTML = `
            <div class="llm-ui-welcome">
                <div class="llm-ui-welcome__icon">👋</div>
                <h2>Ready to chat</h2>
                <p>Send a message to start the conversation</p>
            </div>
        `;
    }

    renderError(error: Error) {
        const div = document.createElement('div');
        div.className = 'llm-ui-banner llm-ui-banner--error';
        div.innerText = `Error: ${error.message}`;
        this.container.appendChild(div);
        this.scrollToBottom(true);
    }

    processEvent(event: OrchestratorEvent) {
        const forceScroll = event.type === 'session_start' || event.type === 'node_start';

        switch (event.type) {
            case 'session_start':
                this.appendSessionGroup(event.payload);
                break;
            case 'node_start':
                this.appendNode(event.payload.parentId, event.payload.node);
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

    private appendSessionGroup(group: SessionGroup) {
        const wrapper = document.createElement('div');
        wrapper.className = `llm-ui-session llm-ui-session--${group.role}`;
        wrapper.dataset.sessionId = group.id;

        if (group.role === 'user') {
            this.renderUserBubble(wrapper, group);
        } else {
            wrapper.innerHTML = `
                <div class="llm-ui-avatar">🤖</div>
                <div class="llm-ui-execution-root" id="container-${group.id}"></div>
            `;
        }

        this.container.appendChild(wrapper);
    }

    private renderUserBubble(wrapper: HTMLElement, group: SessionGroup) {
        const contentPreview = this.getPreviewText(group.content || '');
        const hasSiblings = (group.siblingCount ?? 1) > 1;
        const siblingIndex = group.siblingIndex ?? 0;
        const siblingCount = group.siblingCount ?? 1;

        wrapper.innerHTML = `
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
                        <button class="llm-ui-btn-bubble-tool" data-action="retry" title="Resend">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path>
                                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                            </svg>
                        </button>
                        <button class="llm-ui-btn-bubble-tool" data-action="edit" title="Edit">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                            </svg>
                        </button>
                        <button class="llm-ui-btn-bubble-tool" data-action="copy" title="Copy">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                        </button>
                        <button class="llm-ui-btn-bubble-tool" data-action="delete" title="Delete">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"></polyline>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                        </button>
                        <button class="llm-ui-btn-bubble-tool" data-action="collapse" title="Collapse">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="18 15 12 9 6 15"></polyline>
                            </svg>
                        </button>
                    </div>
                </div>
                <div class="llm-ui-bubble__body">
                    <div class="llm-ui-mount-point" id="user-mount-${group.id}"></div>
                    
                    <!-- ✨ [新增] 编辑确认按钮 -->
                    <div class="llm-ui-edit-actions" style="display:none;">
                        <button class="llm-ui-btn llm-ui-btn--primary" data-action="confirm-edit">
                            Save & Regenerate
                        </button>
                        <button class="llm-ui-btn llm-ui-btn--secondary" data-action="save-only">
                            Save Only
                        </button>
                        <button class="llm-ui-btn llm-ui-btn--ghost" data-action="cancel-edit">
                            Cancel
                        </button>
                    </div>
                </div>
            </div>
        `;

        this.container.appendChild(wrapper);

        // 初始化 MDxController
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
            await this.handleCopy(controller.content, e.target as HTMLElement);
        });

        // Delete
        wrapper.querySelector('[data-action="delete"]')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            await this.handleDeleteConfirm(group.id, 'user');
        });

        // Collapse
        wrapper.querySelector('[data-action="collapse"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleCollapse(bubbleEl, e.target as HTMLElement);
        });

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

    private toggleEditMode(
        nodeId: string, 
        controller: MDxController, 
        editActionsEl: HTMLElement,
        wrapper: HTMLElement
    ) {
        const isEditing = this.editingNodes.has(nodeId);

        if (!isEditing) {
            // 进入编辑模式
            this.originalContentMap.set(nodeId, controller.content);
            this.editingNodes.add(nodeId);
            controller.toggleEdit();
            editActionsEl.style.display = 'flex';
            wrapper.querySelector('[data-action="edit"]')?.classList.add('active');
        } else {
            // 已经在编辑模式，切换回只读
            this.cancelEdit(nodeId, controller, editActionsEl, wrapper);
        }
    }

    private confirmEdit(
        nodeId: string,
        controller: MDxController,
        editActionsEl: HTMLElement,
        wrapper: HTMLElement,
        regenerate: boolean
    ) {
        // 退出编辑模式
        this.editingNodes.delete(nodeId);
        this.originalContentMap.delete(nodeId);
        controller.toggleEdit();
        editActionsEl.style.display = 'none';
        wrapper.querySelector('[data-action="edit"]')?.classList.remove('active');

        // 通知外部
        if (regenerate) {
            this.onNodeAction?.('edit-and-retry', nodeId);
        } else {
            this.onNodeAction?.('edit', nodeId);
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
        element.classList.toggle('is-collapsed');
        const svg = btn.closest('button')?.querySelector('svg');
        if (!svg) return;

        if (element.classList.contains('is-collapsed')) {
            svg.innerHTML = '<polyline points="6 9 12 15 18 9"></polyline>';
        } else {
            svg.innerHTML = '<polyline points="18 15 12 9 6 15"></polyline>';
        }
    }

    private appendNode(parentId: string | undefined, node: ExecutionNode) {
        let parentEl: HTMLElement | null = null;
        
        if (parentId) {
            parentEl = this.nodeMap.get(parentId)?.querySelector('.llm-ui-node__children') || null;
        }
        
        if (!parentEl) {
            const roots = this.container.querySelectorAll('.llm-ui-execution-root');
            if (roots.length > 0) parentEl = roots[roots.length - 1] as HTMLElement;
        }

        if (parentEl) {
            const { element, mountPoints } = NodeRenderer.create(node);
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

    private renderExecutionTree(node: ExecutionNode) {
        this.appendNode(node.parentId, node);
        node.children?.forEach(c => this.renderExecutionTree(c));
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
        // 移除 Markdown 符号 (简单处理)
        const plain = content.replace(/[#*`]/g, '').replace(/\n/g, ' ').trim();
        const truncated = plain.length > 50 ? plain.substring(0, 50) + '...' : plain;
        // 返回纯文本，由调用方决定是否需要转义
        return truncated;
    }

private findSessionGroupByNode(nodeId: string): SessionGroup | null {
    // 这需要 HistoryView 持有对 sessions 的引用
    // 或者通过 DOM 属性查找
    
    // 方法1：通过 DOM 向上查找 data-session-id
    const nodeEl = this.nodeMap.get(nodeId);
    if (nodeEl) {
        const sessionEl = nodeEl.closest('[data-session-id]');
        if (sessionEl) {
            const sessionId = (sessionEl as HTMLElement).dataset.sessionId;
            // 返回对应的 SessionGroup（但 HistoryView 可能没有直接访问 sessions）
            // 这里可以返回 sessionId 让上层处理
        }
    }
    
    return null;
}

    // ✨ [新增] 销毁方法
    destroy() {
        if (this.scrollDebounceTimer) {
            clearTimeout(this.scrollDebounceTimer);
        }
        this.clear();
    }
}
