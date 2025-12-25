// @file: llm-ui/components/HistoryView.ts

import { NodeActionCallback } from '../core/types';
import {OrchestratorEvent, SessionGroup, ExecutionNode, } from '@itookit/llm-engine';
import { NodeRenderer } from './NodeRenderer';
import { MDxController } from './mdx/MDxController';
import { NodeTemplates } from './templates/NodeTemplates';
import { LayoutTemplates } from './templates/LayoutTemplates';
import { escapeHTML, Modal } from '@itookit/common';
import { AssetConfigOptions } from '@itookit/mdxeditor';

/**
 * 包装 common Modal 为 Promise 形式
 */
async function showConfirmDialog(message: string): Promise<boolean> {
    return new Promise((resolve) => {
        let resolved = false;
        
        new Modal('Confirmation', `<p>${escapeHTML(message)}</p>`, {
            type: 'danger',
            confirmText: 'Delete',
            cancelText: 'Cancel',
            onConfirm: () => {
                if (!resolved) {
                    resolved = true;
                    resolve(true);
                }
                return true;
            },
            onCancel: () => {
                if (!resolved) {
                    resolved = true;
                    resolve(false);
                }
                return true;
            }
        }).show();
    });
}

export class HistoryView {
    private nodeMap = new Map<string, HTMLElement>();
    private editorMap = new Map<string, MDxController>();
    private container: HTMLElement;
    
    private shouldAutoScroll = true;
    private scrollThreshold = 150; // 增加阈值，容错率更高
    private scrollFrameId: number | null = null;
    private resizeObserver: ResizeObserver;
    
    // ✅ 新增：流式模式控制
    private isStreamingMode = false;
    private lastScrollHeight = 0;
    private scrollLockUntil = 0;
    
    // ✅ 新增：预览更新节流
    private previewUpdateTimers = new Map<string, number>();
    private readonly PREVIEW_UPDATE_INTERVAL = 200;

    private onContentChange?: (id: string, content: string, type: 'user' | 'node') => void;
    private onNodeAction?: NodeActionCallback;
    
    // ✨ [新增] 保存原始内容用于取消编辑
    private originalContentMap = new Map<string, string>();
    
    // ✨ [新增] 编辑状态跟踪
    private editingNodes = new Set<string>();

    // ✅ 新增：已渲染的 Session ID 集合（用于去重）
    private renderedSessionIds = new Set<string>();

    constructor(
        container: HTMLElement,
        onContentChange?: (id: string, content: string, type: 'user' | 'node') => void,
        onNodeAction?: NodeActionCallback,
        // ✅ [新增] 接收附件目录上下文获取器
        private getAttachmentContext?: () => Promise<{ id: string; pathPrefix: string } | null>
    ) {
        this.container = container;
        this.onContentChange = onContentChange;
        this.onNodeAction = onNodeAction;

        // ✅ 优化：使用 passive 监听器
        this.container.addEventListener('scroll', this.handleScroll.bind(this), { passive: true });

        // 2. 监听内容高度变化 (处理图片加载、MDX渲染导致的高度突变)
        this.resizeObserver = new ResizeObserver(() => {
            if (this.scrollFrameId !== null) return;
            
            this.scrollFrameId = requestAnimationFrame(() => {
                this.scrollFrameId = null;
                this.handleResize();
            });
        });
        this.resizeObserver.observe(this.container);
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
        const existingBanner = this.container.querySelector('.llm-ui-error-banner');
        if (existingBanner) existingBanner.remove();
        
        const banner = document.createElement('div');
        banner.className = 'llm-ui-error-banner';
        banner.innerHTML = `
            <div class="llm-ui-error-banner__content">
                <span class="llm-ui-error-banner__icon">⚠️</span>
                <span class="llm-ui-error-banner__message">${escapeHTML(error.message)}</span>
                <button class="llm-ui-error-banner__close" title="Dismiss">×</button>
            </div>
        `;
        banner.querySelector('.llm-ui-error-banner__close')?.addEventListener('click', () => banner.remove());
        const isSerious = error.message.includes('401') || error.message.includes('API key');
        if (!isSerious) setTimeout(() => banner.remove(), 5000);
        this.container.insertBefore(banner, this.container.firstChild);
        this.scrollToBottom(true);
    }

    // ================================================================
    // ✅ 滚动控制（核心优化）
    // ================================================================

    /**
     * 处理用户滚动
     */
    private handleScroll(): void {
        // 流式输出期间，锁定自动滚动状态
        if (this.isStreamingMode) return;
        
        // 滚动锁定期间不更新状态
        if (Date.now() < this.scrollLockUntil) return;
        
        const { scrollTop, scrollHeight, clientHeight } = this.container;
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
        
        this.shouldAutoScroll = distanceFromBottom < this.scrollThreshold;
    }

    /**
     * 处理内容高度变化
     */
    private handleResize(): void {
        if (!this.shouldAutoScroll && !this.isStreamingMode) return;
        
        const currentScrollHeight = this.container.scrollHeight;
        
        // 只有当高度增加时才滚动（避免内容收缩时的抖动）
        if (currentScrollHeight > this.lastScrollHeight) {
            this.lastScrollHeight = currentScrollHeight;
            this.instantScrollToBottom();
        }
    }

    /**
     * ✅ 新增：瞬时滚动到底部（无动画，用于流式输出）
     */
    private instantScrollToBottom(): void {
        this.container.scrollTop = this.container.scrollHeight;
    }

    /**
     * ✨ [核心优化] 滚动到底部
     * @param force 是否强制滚动（忽略用户当前位置）
     */
    scrollToBottom(force: boolean = false): void {
        if (!force && !this.shouldAutoScroll) return;

        // 如果已经有挂起的滚动任务，取消它（防抖）
        if (this.scrollFrameId !== null) {
            cancelAnimationFrame(this.scrollFrameId);
        }

        this.scrollFrameId = requestAnimationFrame(() => {
            this.scrollFrameId = null;
            this.container.scrollTop = this.container.scrollHeight;
            this.lastScrollHeight = this.container.scrollHeight;
            
            // 滚动后短暂锁定状态检测
            this.scrollLockUntil = Date.now() + 100;
        });
    }

    /**
     * ✅ 新增：进入流式输出模式
     */
    public enterStreamingMode(): void {
        if (this.isStreamingMode) return;
        
        this.isStreamingMode = true;
        this.shouldAutoScroll = true;
        this.lastScrollHeight = this.container.scrollHeight;
        
        // 添加 CSS 类优化渲染
        this.container.classList.add('llm-ui-history--streaming');
    }

    /**
     * ✅ 新增：退出流式输出模式
     */
    public exitStreamingMode(): void {
        if (!this.isStreamingMode) return;
        
        this.isStreamingMode = false;
        
        // 移除 CSS 类
        this.container.classList.remove('llm-ui-history--streaming');
        
        // 最终滚动确保到底部
        this.scrollToBottom(true);
        
        // 清理所有流式状态类
        this.container.querySelectorAll('.llm-ui-node--streaming').forEach(el => {
            el.classList.remove('llm-ui-node--streaming');
        });
        
        // 清理预览定时器
        this.previewUpdateTimers.forEach(timer => clearTimeout(timer));
        this.previewUpdateTimers.clear();
    }

    private appendSessionGroup(group: SessionGroup, isCollapsed: boolean) {
        // ✅ 关键修复：检查是否已渲染
        if (this.renderedSessionIds.has(group.id)) {
            console.warn(`[HistoryView] Duplicate session skipped: ${group.id}`);
            return;
        }
        this.renderedSessionIds.add(group.id);
        
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

    private async initUserBubble(wrapper: HTMLElement, group: SessionGroup) {
        const mountPoint = wrapper.querySelector(`#user-mount-${group.id}`) as HTMLElement;
        
        // ✅ 1. 动态获取附件配置
        let assetConfig: AssetConfigOptions | undefined;
        if (this.getAttachmentContext) {
            const ctx = await this.getAttachmentContext();
            if (ctx) {
                assetConfig = {
                    targetAttachmentDirectoryId: ctx.id,
                    pathStrategy: (filename) => `${ctx.pathPrefix}${filename}`,
                    uploadLimit: { maxSize: 20 * 1024 * 1024 }
                };
            }
        }

        const controller = new MDxController(mountPoint, group.content || '', {
            readOnly: true,
            assetConfig, // ✅ 传入配置
            onChange: (text) => {
                this.onContentChange?.(group.id, text, 'user');
                const previewEl = wrapper.querySelector('.llm-ui-header-preview');
                if (previewEl) previewEl.textContent = this.getPreviewText(text);
            }
        });
        this.editorMap.set(group.id, controller);
        this.bindUserBubbleEvents(wrapper, group, controller);
    }

    private bindUserBubbleEvents(wrapper: HTMLElement, group: SessionGroup, controller: MDxController) {
        const bubbleEl = wrapper.querySelector('.llm-ui-bubble--user') as HTMLElement;
        const editActionsEl = wrapper.querySelector('.llm-ui-edit-actions') as HTMLElement;
        
        if (!bubbleEl) return;

        // Action Bindings
        wrapper.querySelector('[data-action="retry"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.onNodeAction?.('resend', group.id);
        });

        wrapper.querySelector('[data-action="edit"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleEditMode(group.id, controller, editActionsEl, wrapper);
        });

        wrapper.querySelector('[data-action="copy"]')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            await this.handleCopy(controller.content, e.currentTarget as HTMLElement);
        });

        wrapper.querySelector('[data-action="delete"]')?.addEventListener('click', async (e) => {
            e.stopPropagation();
            await this.handleDeleteConfirm(group.id, 'user');
        });

        const collapseBtn = wrapper.querySelector('[data-action="collapse"]');
        if (collapseBtn) {
            collapseBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleCollapse(bubbleEl, e.currentTarget as HTMLElement);
            });
        }

        // Branch Nav
        wrapper.querySelector('[data-action="prev-sibling"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.onNodeAction?.('prev-sibling', group.id);
        });

        wrapper.querySelector('[data-action="next-sibling"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.onNodeAction?.('next-sibling', group.id);
        });

        // Edit Confirm/Cancel
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
            // (Save-only)
            this.confirmEdit(nodeId, controller, actionsEl, wrapper, false);
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
                    foundUser = false;
                }
            }
        });
        return count;
    }

    private toggleCollapse(element: HTMLElement, btn: HTMLElement) {
        element.classList.toggle('is-collapsed');
        const isCollapsed = element.classList.contains('is-collapsed');
        
        const svg = btn.querySelector('svg');
        if (svg) {
            svg.innerHTML = isCollapsed 
                ? '<polyline points="6 9 12 15 18 9"></polyline>'
                : '<polyline points="18 15 12 9 6 15"></polyline>';
        }
    }

    private renderExecutionTree(node: ExecutionNode, isCollapsed: boolean = false) {
        this.appendNode(node.parentId, node, isCollapsed);
        node.children?.forEach(c => this.renderExecutionTree(c, isCollapsed));
    }

    private appendNode(parentId: string | undefined, node: ExecutionNode, isCollapsed: boolean) {
        // ✅ 关键修复：检查是否已渲染
        if (this.nodeMap.has(node.id)) {
            console.warn(`[HistoryView] Duplicate node skipped: ${node.id}`);
            return;
        }
        
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
            
            if (isCollapsed) {
                element.classList.add('is-collapsed');
                const svg = element.querySelector('[data-action="collapse"] svg');
                if (svg) svg.innerHTML = '<polyline points="6 9 12 15 18 9"></polyline>';
            }

            this.nodeMap.set(node.id, element);
            parentEl.appendChild(element);

            this.bindNodeEvents(element, node, mountPoints);
        }
    }

    private async bindNodeEvents(element: HTMLElement, node: ExecutionNode, mountPoints: any) {
        const editBtn = element.querySelector('[data-action="edit"]');
        const copyBtn = element.querySelector('[data-action="copy"]');
        const collapseBtn = element.querySelector('[data-action="collapse"]');
        const retryBtn = element.querySelector('[data-action="retry"]');
        const deleteBtn = element.querySelector('[data-action="delete"]');

        const getSessionId = (): string => {
            const sessionEl = element.closest('[data-session-id]');
            return (sessionEl as HTMLElement)?.dataset.sessionId || node.id;
        };
        const effectiveId = getSessionId();

        // ✨ [新增] 绑定 Agent 图标点击事件
        const iconEl = element.querySelector('.llm-ui-node__icon--clickable');
        if (iconEl) {
            iconEl.addEventListener('click', (e) => {
                e.stopPropagation();
                const agentId = (e.currentTarget as HTMLElement).dataset.agentId;
                if (agentId) {
                    console.log(`[HistoryView] Clicked agent: ${agentId}`);
                    // 向上派发自定义事件
                    this.container.dispatchEvent(new CustomEvent('open-agent-config', {
                        bubbles: true,
                        detail: { agentId }
                    }));
                }
            });
        }

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
            // ✅ 判断是否为正在运行的流 (running 或 queued)
            const isStreamingNode = node.status === 'running' || node.status === 'queued';
            
            // ✅ 1. 动态获取附件配置 (同上)
            let assetConfig: AssetConfigOptions | undefined;
            if (this.getAttachmentContext) {
                const ctx = await this.getAttachmentContext();
                if (ctx) {
                    assetConfig = {
                        targetAttachmentDirectoryId: ctx.id,
                        pathStrategy: (filename) => `${ctx.pathPrefix}${filename}`,
                        uploadLimit: { maxSize: 20 * 1024 * 1024 }
                    };
                }
            }

            const controller = new MDxController(mountPoints.output, node.data.output || '', {
                readOnly: true,
                streaming: isStreamingNode,
                assetConfig, // ✅ 传入配置
                onChange: (text) => {
                    if (controller.isEditing()) {
                        this.onContentChange?.(effectiveId, text, 'node');
                    }
                    const previewEl = element.querySelector('.llm-ui-header-preview');
                    if (previewEl) previewEl.textContent = this.getPreviewText(text);
                }
            });
            this.editorMap.set(node.id, controller);

            editBtn?.addEventListener('click', async () => {
                const wasEditing = controller.isEditing();
                await controller.toggleEdit();
                editBtn.classList.toggle('active');
                
                // 退出编辑模式时保存
                if (wasEditing) {
                    this.onContentChange?.(effectiveId, controller.content, 'node');
                }
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

        // ✅ 添加流式状态类（只在首次）
        if (!el.classList.contains('llm-ui-node--streaming')) {
            el.classList.add('llm-ui-node--streaming');
        }

        if (field === 'thought') {
            const container = el.querySelector('.llm-ui-thought') as HTMLElement;
            const contentEl = el.querySelector('.llm-ui-thought__content') as HTMLElement;

            if (container && container.style.display === 'none') {
                container.style.display = 'block';
            }
            if (contentEl) {
                // ✅ 使用 insertAdjacentText 更高效
                contentEl.insertAdjacentText('beforeend', chunk);
                if (container) container.scrollTop = container.scrollHeight;
            }
        } else if (field === 'output') {
            const editor = this.editorMap.get(nodeId);
            if (editor) {
                editor.appendStream(chunk);
                
                // ✅ 使用节流更新预览
                this.schedulePreviewUpdate(nodeId, el, editor);
            }
        }
    }

    /**
     * ✅ 新增：节流更新预览文本
     */
    private schedulePreviewUpdate(nodeId: string, el: HTMLElement, editor: MDxController): void {
        // 如果已有定时器，跳过
        if (this.previewUpdateTimers.has(nodeId)) return;

        const timerId = window.setTimeout(() => {
            this.previewUpdateTimers.delete(nodeId);
            
            const previewEl = el.querySelector('.llm-ui-header-preview');
            if (previewEl) {
                previewEl.textContent = this.getPreviewText(editor.content);
            }
        }, this.PREVIEW_UPDATE_INTERVAL);

        this.previewUpdateTimers.set(nodeId, timerId);
    }

    private updateNodeStatus(nodeId: string, status: string, result?: any) {
        const el = this.nodeMap.get(nodeId);
        if (el) {
            // ✅ 移除流式状态类
            el.classList.remove('llm-ui-node--streaming');
            
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
            
            // ✅ 清理该节点的预览更新定时器
            const timer = this.previewUpdateTimers.get(nodeId);
            if (timer) {
                clearTimeout(timer);
                this.previewUpdateTimers.delete(nodeId);
            }
            
            // ✅ 立即更新最终预览
            const editor = this.editorMap.get(nodeId);
            const previewEl = el.querySelector('.llm-ui-header-preview');
            if (editor && previewEl) {
                previewEl.textContent = this.getPreviewText(editor.content);
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

    /**
     * ✅ 新增：公开方法，允许外部直接删除消息
     * @param ids 要删除的消息 ID 数组
     * @param animated 是否使用动画
     */
    public removeMessages(ids: string[], animated: boolean = true): void {
        for (const id of ids) {
            // ✅ 从去重集合移除
            this.renderedSessionIds.delete(id);
            
            // 处理 Session 元素
            const sessionEl = this.container.querySelector(`[data-session-id="${id}"]`) as HTMLElement;
            if (sessionEl) {
                this.removeElement(sessionEl, animated);
            }

            // 2. 处理 Node 元素
            const nodeEl = this.nodeMap.get(id);
            if (nodeEl) {
                this.removeElement(nodeEl, animated);
                this.nodeMap.delete(id);
            }

            // 3. 清理编辑器
            const editor = this.editorMap.get(id);
            if (editor) {
                editor.destroy();
                this.editorMap.delete(id);
            }

            // 4. 清理预览更新定时器
            const timer = this.previewUpdateTimers.get(id);
            if (timer) {
                clearTimeout(timer);
                this.previewUpdateTimers.delete(id);
            }

            // 5. 清理状态
            this.originalContentMap.delete(id);
            this.editingNodes.delete(id);
        }

        // 6. 延迟检查是否需要显示欢迎界面
        const delay = animated ? 350 : 0;
        setTimeout(() => this.checkEmpty(), delay);
    }

    /**
     * 移除单个元素
     */
    private removeElement(el: HTMLElement, animated: boolean): void {
        if (animated) {
            el.classList.add('llm-ui-session--deleting');
            el.addEventListener('animationend', () => el.remove(), { once: true });
            // 备用：如果动画没触发，300ms 后强制删除
            setTimeout(() => {
                if (el.parentNode) el.remove();
            }, 350);
        } else {
            el.remove();
        }
    }

    /**
     * 检查是否为空并显示欢迎界面
     */
    private checkEmpty(): void {
        const remaining = this.container.querySelectorAll(
            '.llm-ui-session:not(.llm-ui-session--deleting)'
        );
        if (remaining.length === 0) {
            this.renderWelcome();
        }
    }

    private handleMessagesDeleted(deletedIds: string[]) {
        this.removeMessages(deletedIds, true);
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

    private getPreviewText(content: string): string {
        if (!content) return '';
        let plain = content.replace(/[\r\n]+/g, ' ');
        plain = plain.replace(/[*#`_~[\]()]/g, '');
        plain = plain.trim();
        if (!plain) return ''; 
        return plain.length > 60 ? plain.substring(0, 60) + '...' : plain;
    }


    // ✅ 新增：将错误渲染进聊天流
    public appendErrorBubble(error: Error) {
        // 移除旧的流式状态
        this.exitStreamingMode();

        const wrapper = document.createElement('div');
        wrapper.className = 'llm-ui-session llm-ui-session--system';
        
        const isAuthError = error.message.includes('apiKey') || error.message.includes('401');
        
        // [修复] 删除未使用的 isConnectionError 变量
        // const isConnectionError = error.message.includes('ECONNREFUSED') || error.message.includes('Network');

        let actionButtons = '';
        
        // 根据错误类型提供快捷操作按钮
        if (isAuthError) {
            actionButtons = `
                <button class="llm-ui-error-btn" data-action="open-settings">⚙️ 配置连接</button>
            `;
        }
        
        // 总是提供重试按钮
        actionButtons += `
            <button class="llm-ui-error-btn" data-action="retry-last">↻ 重试</button>
        `;

        wrapper.innerHTML = `
            <div class="llm-ui-bubble llm-ui-bubble--error">
                <strong>⚠️ 执行失败</strong>
                <div class="llm-ui-bubble--error__content">
                    ${escapeHTML(error.message)}
                </div>
                <div class="llm-ui-bubble--error__actions">
                    ${actionButtons}
                </div>
            </div>
        `;

        this.container.appendChild(wrapper);
        this.scrollToBottom(true);

        // 绑定按钮事件
        const settingsBtn = wrapper.querySelector('[data-action="open-settings"]');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => {
                // ✅ 这里触发的事件会被 LLMWorkspaceEditor 捕获
                this.container.dispatchEvent(new CustomEvent('open-connection-settings', { bubbles: true }));
            });
        }

        const retryBtn = wrapper.querySelector('[data-action="retry-last"]');
        if (retryBtn) {
            retryBtn.addEventListener('click', () => {
                // 简单的重试逻辑：移除错误气泡，触发重试
                wrapper.remove();
                // 找到最后一个可重试的节点
                const lastNode = this.findLastRetryableId();
                if (lastNode) {
                    this.onNodeAction?.('retry', lastNode);
                }
            });
        }
    }

    private findLastRetryableId(): string | null {
        // 简单的查找逻辑：找最后一个 user session 或 assistant node
        // 实际逻辑可能需要根据你的 SessionManager 结构调整
        const allSessions = Array.from(this.container.querySelectorAll('[data-session-id]'));
        if (allSessions.length > 0) {
            return (allSessions[allSessions.length - 1] as HTMLElement).dataset.sessionId || null;
        }
        return null;
    }

    processEvent(event: OrchestratorEvent) {
        switch (event.type) {
            case 'session_start':
                this.enterStreamingMode();
                this.appendSessionGroup(event.payload, false);
                this.scrollToBottom(true);
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
                this.exitStreamingMode();
                this.editorMap.forEach(editor => editor.finishStream());
                break;
            case 'error':
                this.exitStreamingMode();
            // ✅ 修复：显示更详细的错误信息
                const errorMessage = event.payload.message || 'Unknown error';
                const errorCode = (event.payload as any).code;
            
            // 根据错误类型显示不同的提示
            if (errorCode === 401) {
                this.appendErrorBubble(new Error(`🔐 ${errorMessage}`));
            } else if (errorCode === 429) {
                this.appendErrorBubble(new Error(`⏳ ${errorMessage}`));
            } else {
                this.appendErrorBubble(new Error(errorMessage));
            }
                
                // 同时结束所有流式编辑器
                this.editorMap.forEach(editor => editor.finishStream(false));
                break;
            case 'messages_deleted':
                this.handleMessagesDeleted(event.payload.deletedIds);
                break;
            case 'message_edited':
                this.handleMessageEdited(event.payload.sessionId, event.payload.newContent);
                break;
            case 'session_cleared':
                this.renderWelcome();
                break;
            case 'sibling_switch':
                this.handleSiblingSwitch(event.payload);
                break;
            case 'retry_started':
                this.enterStreamingMode();
                break;
        }
    }

    clear() {
        // 取消所有挂起的操作
        if (this.scrollFrameId !== null) {
            cancelAnimationFrame(this.scrollFrameId);
            this.scrollFrameId = null;
        }
        
        // 清理预览更新定时器
        this.previewUpdateTimers.forEach(timer => clearTimeout(timer));
        this.previewUpdateTimers.clear();
        
        // 清理编辑器
        this.editorMap.forEach(editor => editor.destroy());
        this.editorMap.clear();
        
        // 清理其他状态
        this.nodeMap.clear();
        this.originalContentMap.clear();
        this.editingNodes.clear();
        
        // 重置滚动状态
        this.isStreamingMode = false;
        this.shouldAutoScroll = true;
        this.lastScrollHeight = 0;
        this.container.classList.remove('llm-ui-history--streaming');
        
        // 清空 DOM
        this.container.innerHTML = '';
    }


    // ✨ [新增] 销毁方法
    destroy() {
        if (this.scrollFrameId !== null) {
            cancelAnimationFrame(this.scrollFrameId);
        }
        this.resizeObserver.disconnect();
        this.clear();
    }
}
