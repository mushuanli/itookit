// @file: llm-ui/components/HistoryView.ts

import { NodeActionCallback, BranchActionCallback } from '../core/types';
import { OrchestratorEvent, SessionGroup, ExecutionNode } from '@itookit/llm-engine';
import { NodeRenderer } from './NodeRenderer';
import { MDxController } from './mdx/MDxController';
import { NodeTemplates } from './templates/NodeTemplates';
import { LayoutTemplates } from './templates/LayoutTemplates';
import { ErrorTemplates } from './templates/ErrorTemplates';
import { showConfirmDialog, ISessionEngine } from '@itookit/common';
import { CollapseStateMap } from '../core/types';

export interface HistoryViewOptions {
    nodeId?: string;
    ownerNodeId?: string;
    sessionEngine?: ISessionEngine;
    onCollapseStateChange?: (states: CollapseStateMap) => void;
    initialCollapseStates?: CollapseStateMap;
}

export class HistoryView {
    private nodeMap = new Map<string, HTMLElement>();
    private editorMap = new Map<string, MDxController>();
    private container: HTMLElement;

    private shouldAutoScroll = true;
    private scrollThreshold = 150;
    private scrollFrameId: number | null = null;
    private resizeObserver: ResizeObserver;

    // ✅ 新增：流式模式控制
    private isStreamingMode = false;
    private lastScrollHeight = 0;
    private scrollLockUntil = 0;

    // ✅ 新增：用户是否正在查看历史内容
    private userIsScrolledUp = false;

    // 预览更新节流
    private previewUpdateTimers = new Map<string, number>();

    private onContentChange?: (id: string, content: string, type: 'user' | 'node') => void;
    private onNodeAction?: NodeActionCallback;

    // 保存原始内容用于取消编辑
    private originalContentMap = new Map<string, string>();

    // 编辑状态跟踪
    private editingNodes = new Set<string>();

    // 已渲染的 Session ID 集合（用于去重）
    private renderedSessionIds = new Set<string>();

    // 保存上下文
    private contextOptions: HistoryViewOptions;

    // ✅ 新增：折叠状态存储
    private collapseStates: CollapseStateMap = {};
    private onCollapseStateChange?: (states: CollapseStateMap) => void;

    // ✅ 新增：事件批量处理
    private eventQueue: OrchestratorEvent[] = [];
    private eventProcessTimer: number | null = null;
    private readonly EVENT_BATCH_INTERVAL = 50;

    // ✅ 新增：滚动节流
    private scrollThrottleTimer: number | null = null;
    private readonly SCROLL_THROTTLE = 100;

    // ✅ 新增：思考区域滚动节流
    private thoughtScrollThrottled = false;

    // ✅ 新增：新内容提示器
    private newContentIndicator: HTMLElement | null = null;


    // ✅ 新增：分支操作回调
    private onBranchAction?: BranchActionCallback;

    constructor(
        container: HTMLElement,
        onContentChange?: (id: string, content: string, type: 'user' | 'node') => void,
        onNodeAction?: NodeActionCallback,
        options?: HistoryViewOptions
    ) {
        this.container = container;
        this.onContentChange = onContentChange;
        this.onNodeAction = onNodeAction;
        this.contextOptions = options || {};

        // ✅ 恢复初始状态
        if (options?.initialCollapseStates) {
            this.collapseStates = { ...options.initialCollapseStates };
        }
        this.onCollapseStateChange = options?.onCollapseStateChange;

        // 使用 passive 监听器
        this.container.addEventListener('scroll', this.handleScroll.bind(this), { passive: true });

        // 监听内容高度变化
        this.resizeObserver = new ResizeObserver(() => {
            if (this.scrollFrameId !== null) return;

            this.scrollFrameId = requestAnimationFrame(() => {
                this.scrollFrameId = null;
                this.handleResize();
            });
        });
        this.resizeObserver.observe(this.container);
    }

    // ✅ 新增：获取当前折叠状态
    public getCollapseStates(): CollapseStateMap {
        return { ...this.collapseStates };
    }

    // ✅ 新增：设置折叠状态
    public setCollapseStates(states: CollapseStateMap): void {
        this.collapseStates = { ...states };
    }

    renderFull(sessions: SessionGroup[]) {
        this.clear();
        if (sessions.length === 0) {
            this.renderWelcome();
            return;
        }

        // ✅ 修改：优先使用保存的状态，否则使用智能折叠策略
        const hasStoredStates = Object.keys(this.collapseStates).length > 0;

        let lastUserIndex = -1;
        if (!hasStoredStates) {
            for (let i = sessions.length - 1; i >= 0; i--) {
                if (sessions[i].role === 'user') {
                    lastUserIndex = i;
                    break;
                }
            }
            if (lastUserIndex === -1 && sessions.length > 0) {
                lastUserIndex = sessions.length - 1;
            }
        }

        sessions.forEach((session, index) => {
            let shouldCollapse: boolean;

            // 1. 如果有缓存的持久化状态，优先使用
            if (hasStoredStates && this.collapseStates[session.id] !== undefined) {
                shouldCollapse = this.collapseStates[session.id];
            } else {
                // 2. [新增逻辑]：如果是用户消息，默认折叠
                if (session.role === 'user') {
                    shouldCollapse = true;
                } else {
                    // 3. 助手消息逻辑：如果是最后一条消息则展开，否则折叠
                    shouldCollapse = index < sessions.length - 1;
                }

                // 同步到状态 map 中
                this.collapseStates[session.id] = shouldCollapse;
            }

            this.appendSessionGroup(session, shouldCollapse);

            if (session.executionRoot) {
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
        if (existingBanner) {
            existingBanner.remove();
        }

        const banner = document.createElement('div');
        banner.className = 'llm-ui-error-banner';
        banner.innerHTML = ErrorTemplates.renderErrorBanner(error.message);

        banner.querySelector('.llm-ui-error-banner__close')?.addEventListener('click', () => {
            banner.remove();
        });

        const isSerious = error.message.includes('401') || error.message.includes('API key');
        if (!isSerious) {
            setTimeout(() => banner.remove(), 5000);
        }

        this.container.insertBefore(banner, this.container.firstChild);
        this.scrollToBottom(true);
    }

    // ================================================================
    // 滚动控制
    // ================================================================

    /**
     * 处理用户滚动 - 增强版
     */
    private handleScroll(): void {
        const { scrollTop, scrollHeight, clientHeight } = this.container;
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

        // 判断用户是否正在查看历史内容
        this.userIsScrolledUp = distanceFromBottom > this.scrollThreshold;

        // 如果用户滚动到底部，隐藏新内容提示
        if (!this.userIsScrolledUp) {
            this.hideNewContentIndicator();
        }

        // 非流式模式下才更新自动滚动状态
        if (!this.isStreamingMode) {
            if (Date.now() < this.scrollLockUntil) return;
            this.shouldAutoScroll = distanceFromBottom < this.scrollThreshold;
        }
    }

    /**
     * ✅ 优化：处理内容高度变化
     */
    private handleResize(): void {
        if (!this.shouldAutoScroll && !this.isStreamingMode) return;

        // 节流滚动
        if (this.scrollThrottleTimer !== null) return;

        this.scrollThrottleTimer = window.setTimeout(() => {
            this.scrollThrottleTimer = null;

            const currentScrollHeight = this.container.scrollHeight;

            if (currentScrollHeight > this.lastScrollHeight) {
                this.lastScrollHeight = currentScrollHeight;
                this.instantScrollToBottom();
            }
        }, this.SCROLL_THROTTLE);
    }

    /**
     * ✅ 优化：瞬时滚动到底部
     */
    private instantScrollToBottom(): void {
        if (this.scrollFrameId !== null) return;

        this.scrollFrameId = requestAnimationFrame(() => {
            this.scrollFrameId = null;
            this.container.scrollTop = this.container.scrollHeight;
        });
    }

    /**
     * 滚动到底部
     */
    scrollToBottom(force: boolean = false): void {
        if (!force && !this.shouldAutoScroll) return;

        if (this.scrollFrameId !== null) {
            cancelAnimationFrame(this.scrollFrameId);
        }

        this.scrollFrameId = requestAnimationFrame(() => {
            this.scrollFrameId = null;
            this.container.scrollTop = this.container.scrollHeight;
            this.lastScrollHeight = this.container.scrollHeight;
            this.scrollLockUntil = Date.now() + 100;
        });
    }

    /**
     * 进入流式输出模式
     */
    public enterStreamingMode(): void {
        if (this.isStreamingMode) return;

        this.isStreamingMode = true;
        this.shouldAutoScroll = true;
        this.lastScrollHeight = this.container.scrollHeight;

        this.container.classList.add('llm-ui-history--streaming');
    }

    /**
     * ✅ 优化：退出流式输出模式（智能滚动）
     */
    public exitStreamingMode(): void {
        if (!this.isStreamingMode) return;

        this.isStreamingMode = false;
        this.container.classList.remove('llm-ui-history--streaming');

        // 只有当用户没有主动滚动上去时，才滚动到底部
        if (!this.userIsScrolledUp) {
            this.scrollToBottom(true);
        } else {
            this.showNewContentIndicator();
        }

        // 清理流式状态类
        this.container.querySelectorAll('.llm-ui-node--streaming').forEach(el => {
            el.classList.remove('llm-ui-node--streaming');
        });

        this.previewUpdateTimers.forEach(timer => clearTimeout(timer));
        this.previewUpdateTimers.clear();

        // ✅ 流式结束后更新所有预览
        this.editorMap.forEach((editor, nodeId) => {
            const el = this.nodeMap.get(nodeId);
            if (el) {
                const previewEl = el.querySelector('.llm-ui-header-preview');
                if (previewEl) {
                    previewEl.textContent = this.getPreviewText(editor.content);
                }
            }
        });
    }

    /**
     * ✅ 新增：显示新内容提示器
     */
    private showNewContentIndicator(): void {
        // 避免重复创建
        if (this.newContentIndicator) return;

        this.newContentIndicator = document.createElement('div');
        this.newContentIndicator.className = 'llm-ui-new-content-indicator';
        this.newContentIndicator.innerHTML = ErrorTemplates.renderNewContentIndicator();

        this.newContentIndicator.querySelector('button')?.addEventListener('click', () => {
            this.scrollToBottom(true);
            this.hideNewContentIndicator();
        });

        this.container.appendChild(this.newContentIndicator);
    }

    /**
     * ✅ 新增：隐藏新内容提示器
     */
    private hideNewContentIndicator(): void {
        if (this.newContentIndicator) {
            this.newContentIndicator.remove();
            this.newContentIndicator = null;
        }
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

    /**
     * ✅ 新增：设置分支操作回调
     */
    public setBranchActionCallback(callback: BranchActionCallback): void {
        this.onBranchAction = callback;
    }

    private initUserBubble(wrapper: HTMLElement, group: SessionGroup) {
        const mountPoint = wrapper.querySelector(`#user-mount-${group.id}`) as HTMLElement;
        const controller = new MDxController(mountPoint, group.content || '', {
            readOnly: true,
            onChange: (text) => {
                this.onContentChange?.(group.id, text, 'user');
                const previewEl = wrapper.querySelector('.llm-ui-header-preview');
                if (previewEl) previewEl.textContent = this.getPreviewText(text);
            },
            // ✅ 关键：传递上下文
            nodeId: this.contextOptions.nodeId,
            ownerNodeId: this.contextOptions.ownerNodeId,
            sessionEngine: this.contextOptions.sessionEngine,
        });
        this.editorMap.set(group.id, controller);
        this.bindUserBubbleEvents(wrapper, group, controller);
    }

    private bindUserBubbleEvents(wrapper: HTMLElement, group: SessionGroup, controller: MDxController) {
        const bubbleEl = wrapper.querySelector('.llm-ui-bubble--user') as HTMLElement;
        const editActionsEl = wrapper.querySelector('.llm-ui-edit-actions') as HTMLElement;

        if (!bubbleEl) return;

        // Action Bindings
        wrapper.querySelector('[data-action="resend"]')?.addEventListener('click', (e) => {
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
                this.toggleCollapse(bubbleEl, e.currentTarget as HTMLElement, group.id);
            });
        }

        wrapper.querySelector('[data-action="prev-sibling"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.onNodeAction?.('prev-sibling', group.id);
        });

        wrapper.querySelector('[data-action="create-branch"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.onBranchAction?.('create', group.id);
        });

        wrapper.querySelector('[data-action="next-sibling"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.onNodeAction?.('next-sibling', group.id);
        });

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
            this.originalContentMap.set(nodeId, controller.content);
            this.editingNodes.add(nodeId);
            controller.toggleEdit();
            actionsEl.style.display = 'flex';
            wrapper.querySelector('[data-action="edit"]')?.classList.add('active');

            const bubble = wrapper.querySelector('.llm-ui-bubble--user');
            if (bubble && bubble.classList.contains('is-collapsed')) {
                const collapseBtn = wrapper.querySelector('[data-action="collapse"]');
                if (collapseBtn) (collapseBtn as HTMLElement).click();
            }
        } else {
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
        const newContent = controller.content;
        this.editingNodes.delete(nodeId);
        this.originalContentMap.delete(nodeId);
        controller.toggleEdit();
        editActionsEl.style.display = 'none';
        wrapper.querySelector('[data-action="edit"]')?.classList.remove('active');

        this.onContentChange?.(nodeId, newContent, 'user');
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
        const originalContent = this.originalContentMap.get(nodeId);
        if (originalContent !== undefined) {
            controller.setContent(originalContent);
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

    /**
     * ✅ 优化：流式模式下不保存状态
     */
    private toggleCollapse(element: HTMLElement, btn: HTMLElement, sessionId?: string) {
        const wasCollapsed = element.classList.contains('is-collapsed');
        element.classList.toggle('is-collapsed');
        const isCollapsed = element.classList.contains('is-collapsed');

        const svg = btn.querySelector('svg');
        if (svg) {
            svg.innerHTML = isCollapsed
                ? '<polyline points="6 9 12 15 18 9"></polyline>'
                : '<polyline points="18 15 12 9 6 15"></polyline>';
        }

        if (wasCollapsed && !isCollapsed && sessionId) {
            this.collapseCodeBlocksInSession(sessionId);
        }

        if (sessionId) {
            this.collapseStates[sessionId] = isCollapsed;
            if (!this.isStreamingMode) {
                this.onCollapseStateChange?.(this.collapseStates);
            }
        }
    }


    /**
     * ✨ [新增] 折叠指定 session 内所有编辑器的代码块
     * @param sessionId - session 的 ID
     */
    private async collapseCodeBlocksInSession(sessionId: string): Promise<void> {
        const editorIds = this.getEditorIdsForSession(sessionId);

        if (editorIds.length === 0) return;

        const collapsePromises = editorIds.map(async (editorId) => {
            const controller = this.editorMap.get(editorId);
            if (controller) {
                try {
                    await controller.waitUntilReady();
                    const result = await controller.collapseBlocks();
                    if (result.affectedCount > 0) {
                        console.log(`[HistoryView] Collapsed ${result.affectedCount} code blocks in editor ${editorId}`);
                    }
                } catch (e) {
                    console.warn(`[HistoryView] Failed to collapse code blocks in editor ${editorId}:`, e);
                }
            }
        });

        await Promise.all(collapsePromises);
    }

    /**
     * ✨ [新增] 获取指定 session 关联的所有编辑器 ID
     * @param sessionId - session 的 ID
     * @returns 编辑器 ID 数组
     */
    private getEditorIdsForSession(sessionId: string): string[] {
        const ids: string[] = [];

        if (this.editorMap.has(sessionId)) {
            ids.push(sessionId);
        }

        const sessionEl = this.container.querySelector(`[data-session-id="${sessionId}"]`);
        if (sessionEl) {
            const nodes = sessionEl.querySelectorAll('.llm-ui-node[data-id]');
            nodes.forEach(node => {
                const nodeId = (node as HTMLElement).dataset.id;
                if (nodeId && this.editorMap.has(nodeId)) {
                    ids.push(nodeId);
                }
            });
        }

        return ids;
    }

    /**
     * ✨ [新增] 公开方法：折叠指定 session 的所有代码块
     * 可供外部调用
     */
    public async collapseCodeBlocksForSession(sessionId: string): Promise<void> {
        await this.collapseCodeBlocksInSession(sessionId);
    }

    /**
     * ✨ [新增] 公开方法：展开指定 session 的所有代码块
     */
    public async expandCodeBlocksForSession(sessionId: string): Promise<void> {
        const editorIds = this.getEditorIdsForSession(sessionId);

        const expandPromises = editorIds.map(async (editorId) => {
            const controller = this.editorMap.get(editorId);
            if (controller) {
                try {
                    await controller.waitUntilReady();
                    await controller.expandBlocks();
                } catch (e) {
                    console.warn(`[HistoryView] Failed to expand code blocks in editor ${editorId}:`, e);
                }
            }
        });

        await Promise.all(expandPromises);
    }

    /**
     * ✨ [新增] 公开方法：折叠所有 session 的代码块
     */
    public async collapseAllCodeBlocks(): Promise<void> {
        const promises: Promise<void>[] = [];

        this.editorMap.forEach((controller, id) => {
            promises.push(
                (async () => {
                    try {
                        await controller.waitUntilReady();
                        await controller.collapseBlocks();
                    } catch (e) {
                        console.warn(`[HistoryView] Failed to collapse code blocks in ${id}:`, e);
                    }
                })()
            );
        });

        await Promise.all(promises);
    }

    public async expandAllCodeBlocks(): Promise<void> {
        const promises: Promise<void>[] = [];

        this.editorMap.forEach((controller, id) => {
            promises.push(
                (async () => {
                    try {
                        await controller.waitUntilReady();
                        await controller.expandBlocks();
                    } catch (e) {
                        console.warn(`[HistoryView] Failed to expand code blocks in ${id}:`, e);
                    }
                })()
            );
        });

        await Promise.all(promises);
    }

    /**
     * ✅ New: Get content of the first unfolded Agent chat
     */
    public getFirstUnfoldedAgentContent(): string | null {
        const sessions = Array.from(this.container.querySelectorAll('.llm-ui-session--assistant'));

        for (const session of sessions) {
            const nodes = session.querySelectorAll('.llm-ui-node');

            for (const node of nodes) {
                if (!node.classList.contains('is-collapsed')) {
                    const nodeId = (node as HTMLElement).dataset.id;
                    if (nodeId && this.editorMap.has(nodeId)) {
                        return this.editorMap.get(nodeId)!.content;
                    }
                }
            }
        }
        return null;
    }

    // ✨ [新增] 折叠第一个显示的 unfold chat
    public foldFirstUnfolded(): void {
        // 查找所有 User Bubble 和 Node
        const items = this.container.querySelectorAll('.llm-ui-bubble--user, .llm-ui-node');

        for (const item of items) {
            if (!item.classList.contains('is-collapsed')) {
                // 找到对应的折叠按钮并点击
                const btn = item.querySelector('[data-action="collapse"]') as HTMLElement;
                if (btn) {
                    btn.click();
                    return; // 只折叠一个
                }
            }
        }
    }

    // ✨ [新增] 获取相邻的 Agent Chat Session ID
    // direction: 'next' | 'prev'
    public getNeighborAgentSessionId(currentVisibleId: string | null, direction: 'next' | 'prev'): string | null {
        const sessions = Array.from(this.container.querySelectorAll('.llm-ui-session'));
        if (sessions.length === 0) return null;

        let currentIndex = -1;
        if (currentVisibleId) {
            currentIndex = sessions.findIndex(el => (el as HTMLElement).dataset.sessionId === currentVisibleId);
        }

        if (direction === 'next') {
            // 如果没找到当前，默认从头开始找
            const start = currentIndex === -1 ? -1 : currentIndex;
            for (let i = start + 1; i < sessions.length; i++) {
                if (sessions[i].classList.contains('llm-ui-session--assistant')) {
                    return (sessions[i] as HTMLElement).dataset.sessionId || null;
                }
            }
        } else {
            // prev
            // 如果没找到当前，默认从尾部开始找
            const start = currentIndex === -1 ? sessions.length : currentIndex;
            for (let i = start - 1; i >= 0; i--) {
                if (sessions[i].classList.contains('llm-ui-session--assistant')) {
                    return (sessions[i] as HTMLElement).dataset.sessionId || null;
                }
            }
        }
        return null;
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

    private bindNodeEvents(element: HTMLElement, node: ExecutionNode, mountPoints: any) {
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

        const iconEl = element.querySelector('.llm-ui-node__icon--clickable');
        if (iconEl) {
            iconEl.addEventListener('click', (e) => {
                e.stopPropagation();
                const agentId = (e.currentTarget as HTMLElement).dataset.agentId;
                if (agentId) {
                    this.container.dispatchEvent(new CustomEvent('open-agent-config', {
                        bubbles: true,
                        detail: { agentId }
                    }));
                }
            });
        }

        retryBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.onNodeAction?.('retry', effectiveId);
        });

        deleteBtn?.addEventListener('click', async (e) => {
            e.stopPropagation();
            await this.handleDeleteConfirm(effectiveId, 'assistant');
        });

        collapseBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleCollapse(element, e.target as HTMLElement, effectiveId);
        });

        element.querySelector('[data-action="prev-sibling"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const sessionId = getSessionId();
            this.onNodeAction?.('prev-sibling', sessionId);
        });

        element.querySelector('[data-action="next-sibling"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const sessionId = getSessionId();
            this.onNodeAction?.('next-sibling', sessionId);
        });

        // ✅ 新增：创建分支按钮
        element.querySelector('[data-action="create-branch"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const sessionId = this.getSessionIdFromElement(element);
            this.onBranchAction?.('create', sessionId);
        });

        if (mountPoints.output) {
            const isStreamingNode = node.status === 'running' || node.status === 'queued';

            const controller = new MDxController(mountPoints.output, node.data.output || '', {
                readOnly: true,
                streaming: isStreamingNode,
                onChange: (text) => {
                    if (controller.isEditing()) {
                        this.onContentChange?.(effectiveId, text, 'node');
                    }
                    // 流式模式下不更新预览
                    if (!this.isStreamingMode) {
                        const previewEl = element.querySelector('.llm-ui-header-preview');
                        if (previewEl) previewEl.textContent = this.getPreviewText(text);
                    }
                },
                nodeId: this.contextOptions.nodeId,
                ownerNodeId: this.contextOptions.ownerNodeId,
                sessionEngine: this.contextOptions.sessionEngine,
            });
            this.editorMap.set(node.id, controller);

            editBtn?.addEventListener('click', async () => {
                const wasEditing = controller.isEditing();
                await controller.toggleEdit();
                editBtn.classList.toggle('active');

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

    /**
     * ✅ 优化：更新节点内容（减少 DOM 操作）
     */
    private updateNodeContent(nodeId: string, chunk: string, field: 'thought' | 'output') {
        const el = this.nodeMap.get(nodeId);
        if (!el) return;

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
                contentEl.textContent = (contentEl.textContent || '') + chunk;

                // 节流滚动思考区域
                if (!this.thoughtScrollThrottled) {
                    this.thoughtScrollThrottled = true;
                    requestAnimationFrame(() => {
                        this.thoughtScrollThrottled = false;
                        if (container) container.scrollTop = container.scrollHeight;
                    });
                }
            }
        } else if (field === 'output') {
            const editor = this.editorMap.get(nodeId);
            if (editor) {
                editor.appendStream(chunk);
                // 流式模式下不更新预览
            }
        }
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

            const timer = this.previewUpdateTimers.get(nodeId);
            if (timer) {
                clearTimeout(timer);
                this.previewUpdateTimers.delete(nodeId);
            }

            // 更新最终预览
            const editor = this.editorMap.get(nodeId);
            const previewEl = el.querySelector('.llm-ui-header-preview');
            if (editor && previewEl) {
                previewEl.textContent = this.getPreviewText(editor.content);
            }
        }

        const editor = this.editorMap.get(nodeId);
        if (editor && (status === 'success' || status === 'failed')) {
            editor.finishStream(false);
        }
    }

    public removeMessages(ids: string[], animated: boolean = true): string[] {
        const actuallyRemoved: string[] = [];

        for (const id of ids) {
            // ✅ 检查是否存在
            const sessionEl = this.container.querySelector(`[data-session-id="${id}"]`);
            const nodeEl = this.nodeMap.get(id);

            if (!sessionEl && !nodeEl) {
                console.warn(`[HistoryView] Cannot remove ${id}: not found in DOM`);
                continue;
            }

            // ✅ 清理渲染记录
            this.renderedSessionIds.delete(id);

            // ✅ 移除 DOM
            if (sessionEl) {
                this.removeElement(sessionEl as HTMLElement, animated);
            }
            if (nodeEl) {
                this.removeElement(nodeEl, animated);
                this.nodeMap.delete(id);
            }

            // ✅ 清理编辑器
            const editor = this.editorMap.get(id);
            if (editor) {
                editor.destroy();
                this.editorMap.delete(id);
            }

            // ✅ 清理定时器
            const timer = this.previewUpdateTimers.get(id);
            if (timer) {
                clearTimeout(timer);
                this.previewUpdateTimers.delete(id);
            }

            // ✅ 清理状态
            this.originalContentMap.delete(id);
            this.editingNodes.delete(id);
            delete this.collapseStates[id];

            actuallyRemoved.push(id);
        }

        // ✅ 检查是否为空
        const delay = animated ? 350 : 0;
        setTimeout(() => this.checkEmpty(), delay);

        return actuallyRemoved;
    }

    private removeElement(el: HTMLElement, animated: boolean): void {
        if (animated) {
            el.classList.add('llm-ui-session--deleting');
            el.addEventListener('animationend', () => el.remove(), { once: true });
            setTimeout(() => {
                if (el.parentNode) el.remove();
            }, 350);
        } else {
            el.remove();
        }
    }

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

    private handleMessageEdited(sessionId: string, newContent: string) {
        const sessionEl = this.container.querySelector(`[data-session-id="${sessionId}"]`);
        if (sessionEl) {
            const previewEl = sessionEl.querySelector('.llm-ui-header-preview');
            if (previewEl) {
                previewEl.textContent = this.getPreviewText(newContent);
            }
        }
    }

    private handleSiblingSwitch(payload: { sessionId: string; newIndex: number; total: number }) {
        const sessionEl = this.container.querySelector(`[data-session-id="${payload.sessionId}"]`);
        if (!sessionEl) return;

        const indicator = sessionEl.querySelector('.llm-ui-branch-indicator');
        if (indicator) {
            indicator.textContent = `${payload.newIndex + 1}/${payload.total}`;
        }

        const prevBtn = sessionEl.querySelector('[data-action="prev-sibling"]') as HTMLButtonElement;
        const nextBtn = sessionEl.querySelector('[data-action="next-sibling"]') as HTMLButtonElement;

        if (prevBtn) prevBtn.disabled = payload.newIndex === 0;
        if (nextBtn) nextBtn.disabled = payload.newIndex === payload.total - 1;
    }

    private getPreviewText(content: string): string {
        if (!content) return '';
        let plain = content.replace(/[\r\n]+/g, ' ');
        plain = plain.replace(/[*#`_~[\]()]/g, '');
        plain = plain.trim();
        if (!plain) return '';
        return plain.length > 60 ? plain.substring(0, 60) + '...' : plain;
    }

    public appendErrorBubble(error: Error) {
        this.exitStreamingMode();

        const wrapper = document.createElement('div');
        wrapper.className = 'llm-ui-session llm-ui-session--system';

        const isAuthError = error.message.includes('apiKey') || error.message.includes('401');
        wrapper.innerHTML = ErrorTemplates.renderErrorBubble(error.message, isAuthError);

        this.container.appendChild(wrapper);
        this.scrollToBottom(true);

        const settingsBtn = wrapper.querySelector('[data-action="open-settings"]');
        if (settingsBtn) {
            settingsBtn.addEventListener('click', () => {
                this.container.dispatchEvent(new CustomEvent('open-connection-settings', { bubbles: true }));
            });
        }

        const retryBtn = wrapper.querySelector('[data-action="retry-last"]');
        if (retryBtn) {
            retryBtn.addEventListener('click', () => {
                wrapper.remove();
                const lastNode = this.findLastRetryableId();
                if (lastNode) {
                    this.onNodeAction?.('retry', lastNode);
                }
            });
        }
    }

    private findLastRetryableId(): string | null {
        const allSessions = Array.from(this.container.querySelectorAll('[data-session-id]'));
        if (allSessions.length > 0) {
            return (allSessions[allSessions.length - 1] as HTMLElement).dataset.sessionId || null;
        }
        return null;
    }

    // ================================================================
    // ✅ 优化：事件批量处理
    // ================================================================

    /**
     * ✅ 优化：批量处理事件
     */
    processEvent(event: OrchestratorEvent) {
        switch (event.type) {
            case 'branch_created':
                this.handleBranchCreated(event.payload);
                return;

            case 'branch_renamed':
                this.handleBranchRenamed(event.payload);
                return;

            case 'branch_deleted':
                this.handleBranchDeleted(event.payload);
                return;

            case 'branch_switched':
                this.handleBranchSwitched(event.payload);
                return;

            default:
                if (event.type !== 'node_update') {
                    this.processEventImmediate(event);
                    return;
                }
                break;
        }


        // 流式更新事件批量处理
        this.eventQueue.push(event);

        if (this.eventProcessTimer === null) {
            this.eventProcessTimer = window.setTimeout(() => {
                this.flushEventQueue();
            }, this.EVENT_BATCH_INTERVAL);
        }
    }

    /**
     * ✅ 新增：批量处理队列中的事件
     */
    private flushEventQueue(): void {
        this.eventProcessTimer = null;

        if (this.eventQueue.length === 0) return;

        // 按 nodeId 合并 chunk
        const mergedChunks = new Map<string, { thought: string; output: string }>();

        for (const event of this.eventQueue) {
            if (event.type !== 'node_update') continue;

            const { nodeId, chunk, field } = event.payload;
            if (!chunk || !field) continue;

            if (!mergedChunks.has(nodeId)) {
                mergedChunks.set(nodeId, { thought: '', output: '' });
            }

            const merged = mergedChunks.get(nodeId)!;
            if (field === 'thought') {
                merged.thought += chunk;
            } else if (field === 'output') {
                merged.output += chunk;
            }
        }

        // 清空队列
        this.eventQueue = [];

        // 批量更新
        for (const [nodeId, chunks] of mergedChunks) {
            if (chunks.thought) {
                this.updateNodeContent(nodeId, chunks.thought, 'thought');
            }
            if (chunks.output) {
                this.updateNodeContent(nodeId, chunks.output, 'output');
            }
        }

        // 只滚动一次
        if (!this.userIsScrolledUp) {
            this.scrollToBottom(false);
        }
    }

    /**
     * ✅ 原有的处理逻辑
     */
    private processEventImmediate(event: OrchestratorEvent) {
        switch (event.type) {
            case 'session_start':
                this.enterStreamingMode();
                // [修改]：新消息产生时，如果是用户消息，强制折叠
                // 如果希望用户刚发完能看到，这里传 false；如果要求“绝对保持fold”，传 true
                const isUser = event.payload.role === 'user';
                const defaultFold = isUser ? true : false;

                this.appendSessionGroup(event.payload, defaultFold);

                // 记录状态
                this.collapseStates[event.payload.id] = defaultFold;

                this.scrollToBottom(true);
                break;

            case 'node_start':
                this.appendNode(event.payload.parentId, event.payload.node, false);
                break;

            case 'node_status':
                this.updateNodeStatus(
                    event.payload.nodeId,
                    event.payload.status,
                    event.payload.result
                );
                break;

            case 'finished':
                // 先处理队列中剩余的事件
                if (this.eventProcessTimer !== null) {
                    clearTimeout(this.eventProcessTimer);
                    this.flushEventQueue();
                }

                this.exitStreamingMode();
                this.editorMap.forEach(editor => editor.finishStream());

                // 流式结束后，保存折叠状态
                this.onCollapseStateChange?.(this.collapseStates);
                break;

            case 'error':
                if (this.eventProcessTimer !== null) {
                    clearTimeout(this.eventProcessTimer);
                    this.flushEventQueue();
                }

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

    /**
     * ✅ 新增：从元素获取 sessionId
     */
    private getSessionIdFromElement(element: HTMLElement): string {
        const sessionEl = element.closest('[data-session-id]');
        return (sessionEl as HTMLElement)?.dataset.sessionId || '';
    }

    /**
     * ✅ 新增：处理分支创建事件
     */
    private handleBranchCreated(payload: { sourceId: string; newId: string; branchName?: string }): void {
        console.log(`[HistoryView] Branch created: ${payload.newId} from ${payload.sourceId}`);

        // 更新源节点的分支计数
        const sourceEl = this.findElementBySessionId(payload.sourceId);
        if (sourceEl) {
            const indicator = sourceEl.querySelector('.llm-ui-branch-indicator');
            if (indicator) {
                const countEl = indicator.querySelector('.llm-ui-branch-count');
                if (countEl) {
                    const [current, total] = countEl.textContent?.split('/').map(Number) || [1, 1];
                    countEl.textContent = `${current}/${total + 1}`;
                }
            }
        }

        // 显示成功提示
        this.showBranchNotification(`Branch "${payload.branchName || 'Untitled'}" created`);
    }

    /**
     * ✅ 新增：处理分支重命名事件
     */
    private handleBranchRenamed(payload: { nodeId: string; newName: string }): void {
        const el = this.findElementBySessionId(payload.nodeId);
        if (el) {
            const nameEl = el.querySelector('.llm-branch-name');
            if (nameEl) {
                nameEl.textContent = payload.newName;
            }
        }
    }

    /**
     * ✅ 新增：处理分支删除事件
     */
    private handleBranchDeleted(payload: { deletedIds: string[] }): void {
        // 移除已删除的消息
        this.removeMessages(payload.deletedIds, true);
    }

    /**
     * ✅ 新增：处理分支切换事件
     */
    private handleBranchSwitched(payload: { fromId: string; toId: string }): void {
        // 更新激活状态
        this.collapseStates = {};
        const fromEl = this.findElementBySessionId(payload.fromId);
        const toEl = this.findElementBySessionId(payload.toId);

        if (fromEl) {
            fromEl.classList.remove('is-active-branch');
        }
        if (toEl) {
            toEl.classList.add('is-active-branch');
            toEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    /**
     * ✅ 新增：根据 sessionId 查找元素
     */
    private findElementBySessionId(sessionId: string): HTMLElement | null {
        return this.container.querySelector(`[data-session-id="${sessionId}"]`) as HTMLElement ||
            this.nodeMap.get(sessionId) || null;
    }

    /**
     * ✅ 新增：显示分支通知
     */
    private showBranchNotification(message: string): void {
        const notification = document.createElement('div');
        notification.className = 'llm-branch-notification';
        notification.textContent = ErrorTemplates.renderBranchNotification(message);

        this.container.appendChild(notification);

        requestAnimationFrame(() => {
            notification.classList.add('is-visible');
        });

        setTimeout(() => {
            notification.classList.remove('is-visible');
            setTimeout(() => notification.remove(), 300);
        }, 2000);
    }

    clear() {
        if (this.scrollFrameId !== null) {
            cancelAnimationFrame(this.scrollFrameId);
            this.scrollFrameId = null;
        }

        this.previewUpdateTimers.forEach(timer => clearTimeout(timer));
        this.previewUpdateTimers.clear();

        this.editorMap.forEach(editor => editor.destroy());
        this.editorMap.clear();

        this.nodeMap.clear();
        this.originalContentMap.clear();
        this.editingNodes.clear();
        this.renderedSessionIds.clear();

        this.isStreamingMode = false;
        this.shouldAutoScroll = true;
        this.userIsScrolledUp = false;
        this.lastScrollHeight = 0;
        this.container.classList.remove('llm-ui-history--streaming');

        this.container.innerHTML = '';
    }

    destroy() {
        // 清理事件处理定时器
        if (this.eventProcessTimer !== null) {
            clearTimeout(this.eventProcessTimer);
            this.eventProcessTimer = null;
        }

        // 清理滚动节流定时器
        if (this.scrollThrottleTimer !== null) {
            clearTimeout(this.scrollThrottleTimer);
            this.scrollThrottleTimer = null;
        }

        if (this.scrollFrameId !== null) {
            cancelAnimationFrame(this.scrollFrameId);
            this.scrollFrameId = null;
        }

        this.resizeObserver.disconnect();

        this.previewUpdateTimers.forEach(timer => clearTimeout(timer));
        this.previewUpdateTimers.clear();

        this.editorMap.forEach(editor => editor.destroy());
        this.editorMap.clear();

        this.nodeMap.clear();
        this.originalContentMap.clear();
        this.editingNodes.clear();
        this.eventQueue = [];
        this.collapseStates = {};
        this.renderedSessionIds.clear();

        this.isStreamingMode = false;
        this.shouldAutoScroll = true;
        this.userIsScrolledUp = false;
        this.lastScrollHeight = 0;
        this.container.classList.remove('llm-ui-history--streaming');

        this.hideNewContentIndicator();

        this.container.innerHTML = '';
    }
}
