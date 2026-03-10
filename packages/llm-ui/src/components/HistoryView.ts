// @file: llm-ui/components/HistoryView.ts

import { NodeActionCallback } from '../core/types';
import { OrchestratorEvent, SessionGroup, ExecutionNode } from '@itookit/llm-engine';
import { NodeRenderer } from './NodeRenderer';
import { MDxController } from './mdx/MDxController';
import { NodeTemplates } from './templates/NodeTemplates';
import { LayoutTemplates } from './templates/LayoutTemplates';
import { ErrorTemplates } from './templates/ErrorTemplates';
import { showConfirmDialog, ISessionEngine } from '@itookit/common';
import { CollapseStateMap } from '../core/types';
import { EditorEventBus } from '../core/EditorEventBus';
import { ScrollController } from '../utils/ScrollController';
import { ContentResizeTracker } from '../utils/ContentResizeTracker';
import { EventBatchProcessor, BatchedEvents } from '../utils/EventBatchProcessor';
import { EventCleanup } from '../utils/EventCleanup';
import { TimerManager } from '../utils/TimerManager';

export interface HistoryViewOptions {
    onContentChange?: (id: string, content: string, type: 'user' | 'node') => void;
    onNodeAction?: NodeActionCallback;
    bus?: EditorEventBus;
    nodeId?: string;
    ownerNodeId?: string;
    sessionEngine?: ISessionEngine;
    initialCollapseStates?: CollapseStateMap;
    onScroll?: () => void;
}

export class HistoryView {
    private nodeMap = new Map<string, HTMLElement>();
    private editorMap = new Map<string, MDxController>();
    private container: HTMLElement;

    // ✅ 改动：统一滚动控制器（替代分散的滚动逻辑）
    private scrollController: ScrollController;

    // ✅ 改动：统一内容高度追踪（替代直接 ResizeObserver）
    private resizeTracker: ContentResizeTracker;

    // ✅ 改动：统一事件批处理器（替代手动 eventQueue + timer）
    private eventProcessor: EventBatchProcessor;

    // ✅ 改动：统一事件清理
    private events = new EventCleanup();

    // ✅ 改动：统一定时器管理
    private timers = new TimerManager();

    // ✅ 改动：流式模式标记（由 ScrollController 管理滚动，此处只控制 UI 状态）
    private isStreamingMode = false;

    // 思考区域滚动节流
    private thoughtScrollThrottled = false;

    // 预览更新节流
    private previewUpdateTimers = new Map<string, ReturnType<typeof setTimeout>>();

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

    // 折叠状态
    private collapseStates: CollapseStateMap = {};

    // 新内容提示器
    private newContentIndicator: HTMLElement | null = null;

    // 事件总线
    private bus?: EditorEventBus;

    constructor(container: HTMLElement, options: HistoryViewOptions) {
        this.container = container;
        this.onContentChange = options.onContentChange;
        this.onNodeAction = options.onNodeAction;
        this.contextOptions = options;
        this.bus = options.bus;

        // 恢复初始状态
        if (options.initialCollapseStates) {
            this.collapseStates = { ...options.initialCollapseStates };
        }

        // ✅ 改动：统一滚动控制器
        this.scrollController = new ScrollController(container, {
            onUserScrolledUp: () => this.showNewContentIndicator(),
            onUserScrolledDown: () => this.hideNewContentIndicator(),
            onScroll: () => options.onScroll?.(),
        });

        // ✅ 改动：统一内容高度追踪
        this.resizeTracker = new ContentResizeTracker(
            container,
            (newHeight, oldHeight) => {
                if (newHeight > oldHeight) {
                    this.scrollController.handleContentResize();
                }
            }
        );

        // ✅ 改动：统一事件批处理
        this.eventProcessor = new EventBatchProcessor(
            (batched) => this.handleBatchedEvents(batched),
            (event) => this.processEventImmediate(event),
            50
        );

        // ✅ 改动：使用事件委托替代逐个绑定
        this.initEventDelegation();
    }

    // ================================================================
    // ✅ 新增：Command 所需的公开方法
    // ================================================================

    /**
     * 获取 session DOM 元素（供 ScrollToSessionCommand 使用）
     */
    public getSessionElement(sessionId: string): HTMLElement | null {
        return this.container.querySelector(
            `[data-session-id="${sessionId}"]`
        ) as HTMLElement | null;
    }

    // ================================================================
    // 事件委托
    // ================================================================

    // ✅ 新增：单一事件委托处理所有 data-action 点击
    private initEventDelegation(): void {
        this.events.add(this.container, 'click', ((e: MouseEvent) => {
            const target = e.target as HTMLElement;
            const actionEl = target.closest('[data-action]') as HTMLElement;
            if (!actionEl) return;

            const action = actionEl.dataset.action;
            if (!action) return;

            e.stopPropagation();
            this.handleDelegatedAction(action, actionEl, e);
        }) as EventListener);
    }

    // ✅ 新增：统一的委托动作处理器
    private handleDelegatedAction(
        action: string,
        actionEl: HTMLElement,
        _event: MouseEvent
    ): void {
        const sessionEl = actionEl.closest('[data-session-id]') as HTMLElement;
        const sessionId = sessionEl?.dataset.sessionId || '';

        const nodeEl = actionEl.closest('.llm-ui-node') as HTMLElement;
        const nodeId = nodeEl?.dataset.id || sessionId;

        switch (action) {
            case 'collapse': {
                const collapsible = actionEl.closest(
                    '.llm-ui-bubble--user, .llm-ui-node'
                ) as HTMLElement;
                if (collapsible) {
                    this.toggleCollapse(collapsible, actionEl, sessionId || nodeId);
                }
                break;
            }

            case 'copy': {
                const editor = this.editorMap.get(nodeId) || this.editorMap.get(sessionId);
                if (editor) {
                    this.handleCopy(editor.content, actionEl);
                }
                break;
            }

            case 'delete':
                this.handleDeleteConfirm(
                    sessionId,
                    sessionEl?.classList.contains('llm-ui-session--user') ? 'user' : 'assistant'
                );
                break;

            case 'retry':
                this.onNodeAction?.('retry', sessionId);
                break;

            case 'resend':
                this.onNodeAction?.('resend', sessionId);
                break;

            case 'edit': {
                const editor = this.editorMap.get(sessionId);
                if (editor && sessionEl) {
                    const editActionsEl = sessionEl.querySelector('.llm-ui-edit-actions') as HTMLElement;
                    if (editActionsEl) {
                        this.toggleEditMode(sessionId, editor, editActionsEl, sessionEl);
                    }
                } else {
                    // Node 编辑模式
                    const nodeEditor = this.editorMap.get(nodeId);
                    if (nodeEditor) {
                        this.handleNodeEdit(nodeId, sessionId, nodeEditor, actionEl);
                    }
                }
                break;
            }

            case 'confirm-edit': {
                const editor = this.editorMap.get(sessionId);
                if (editor && sessionEl) {
                    const editActionsEl = sessionEl.querySelector('.llm-ui-edit-actions') as HTMLElement;
                    this.confirmEdit(sessionId, editor, editActionsEl, sessionEl, true);
                }
                break;
            }

            case 'save-only': {
                const editor = this.editorMap.get(sessionId);
                if (editor && sessionEl) {
                    const editActionsEl = sessionEl.querySelector('.llm-ui-edit-actions') as HTMLElement;
                    this.confirmEdit(sessionId, editor, editActionsEl, sessionEl, false);
                }
                break;
            }

            case 'cancel-edit': {
                const editor = this.editorMap.get(sessionId);
                if (editor && sessionEl) {
                    const editActionsEl = sessionEl.querySelector('.llm-ui-edit-actions') as HTMLElement;
                    this.cancelEdit(sessionId, editor, editActionsEl, sessionEl);
                }
                break;
            }

            case 'prev-sibling':
                this.onNodeAction?.('prev-sibling', sessionId);
                break;

            case 'next-sibling':
                this.onNodeAction?.('next-sibling', sessionId);
                break;

            case 'create-branch':
                this.bus?.emit('branch:create', { sourceNodeId: sessionId || nodeId });
                break;

            case 'open-settings':
                this.container.dispatchEvent(
                    new CustomEvent('open-connection-settings', { bubbles: true })
                );
                break;

            case 'retry-last': {
                const errorBubble = actionEl.closest('.llm-ui-session--system');
                errorBubble?.remove();
                const lastNode = this.findLastRetryableId();
                if (lastNode) this.onNodeAction?.('retry', lastNode);
                break;
            }
        }
    }

    // ✅ 新增：Node 编辑模式处理
    private async handleNodeEdit(
        _nodeId: string,
        sessionId: string,
        editor: MDxController,
        actionEl: Element
    ): Promise<void> {
        const wasEditing = editor.isEditing();
        await editor.toggleEdit();
        actionEl.classList.toggle('active');

        if (wasEditing) {
            this.onContentChange?.(sessionId, editor.content, 'node');
        }
    }

    // ================================================================
    // 公开 API
    // ================================================================

    public getCollapseStates(): CollapseStateMap {
        return { ...this.collapseStates };
    }

    // ✅ 新增：设置折叠状态
    public setCollapseStates(states: CollapseStateMap): void {
        this.collapseStates = { ...states };
    }

    /**
     * ✅ 修复问题2：清理所有错误提示
     * 
     * 清理 error banner 和 error bubble（system session），
     * 在新一轮对话开始或成功完成时调用。
     */
    public clearErrors(): void {
        // 清理 error banner（由 renderError 创建）
        const banners = this.container.querySelectorAll('.llm-ui-error-banner');
        banners.forEach(banner => banner.remove());

        // 清理 error bubble（由 appendErrorBubble 创建的 system session）
        const errorSessions = this.container.querySelectorAll('.llm-ui-session--system');
        errorSessions.forEach(session => session.remove());
    }

    /**
     * 批量设置所有可折叠元素的折叠状态
     * （供 FoldAllCommand / UnfoldAllCommand 使用）
     */
    public setAllCollapsed(collapsed: boolean): void {
        const items = this.container.querySelectorAll('.llm-ui-bubble--user, .llm-ui-node');

        items.forEach((el) => {
            el.classList.toggle('is-collapsed', collapsed);

            const svg = el.querySelector('[data-action="collapse"] svg');
            if (svg) {
                svg.innerHTML = collapsed
                    ? '<polyline points="6 9 12 15 18 9"></polyline>'
                    : '<polyline points="18 15 12 9 6 15"></polyline>';
            }
        });

        // 更新内部状态
        const sessions = this.container.querySelectorAll('[data-session-id]');
        sessions.forEach(sessionEl => {
            const id = (sessionEl as HTMLElement).dataset.sessionId;
            if (id) {
                this.collapseStates[id] = collapsed;
            }
        });
    }

    /**
     * 切换指定 session 的折叠状态
     * 
     * @param sessionId - session ID
     * @param forceState - 可选，强制设为指定状态（true=折叠, false=展开）
     */
    public toggleSessionCollapse(sessionId: string, forceState?: boolean): void {
        const sessionEl = this.container.querySelector(
            `[data-session-id="${sessionId}"]`
        ) as HTMLElement;
        if (!sessionEl) return;

        // 找到可折叠容器（user bubble 或 node）
        const collapsible = sessionEl.querySelector(
            '.llm-ui-bubble--user, .llm-ui-node'
        ) as HTMLElement;
        if (!collapsible) return;

        const currentCollapsed = collapsible.classList.contains('is-collapsed');
        const targetCollapsed = forceState !== undefined ? forceState : !currentCollapsed;

        if (targetCollapsed === currentCollapsed) return;

        collapsible.classList.toggle('is-collapsed', targetCollapsed);

        const svg = collapsible.querySelector('[data-action="collapse"] svg');
        if (svg) {
            svg.innerHTML = targetCollapsed
                ? '<polyline points="6 9 12 15 18 9"></polyline>'
                : '<polyline points="18 15 12 9 6 15"></polyline>';
        }

        // 展开时折叠内部代码块
        if (!targetCollapsed) {
            this.collapseCodeBlocksInSession(sessionId);
        }

        // 更新状态
        this.collapseStates[sessionId] = targetCollapsed;

        if (!this.isStreamingMode) {
            this.bus?.emit('state:collapseChanged', { states: { ...this.collapseStates } });
        }
    }

    public removeMessages(ids: string[], animated: boolean = true): string[] {
        const actuallyRemoved: string[] = [];

        for (const id of ids) {
            const sessionEl = this.container.querySelector(`[data-session-id="${id}"]`);
            const nodeEl = this.nodeMap.get(id);

            if (!sessionEl && !nodeEl) {
                console.warn(`[HistoryView] Cannot remove ${id}: not found in DOM`);
                continue;
            }

            // ✅ 清理渲染记录
            this.renderedSessionIds.delete(id);

            if (sessionEl) {
                this.removeElement(sessionEl as HTMLElement, animated);
            }
            if (nodeEl) {
                this.removeElement(nodeEl, animated);
                this.nodeMap.delete(id);
            }

            const editor = this.editorMap.get(id);
            if (editor) {
                editor.destroy();
                this.editorMap.delete(id);
            }

            const timer = this.previewUpdateTimers.get(id);
            if (timer) {
                clearTimeout(timer);
                this.previewUpdateTimers.delete(id);
            }

            this.originalContentMap.delete(id);
            this.editingNodes.delete(id);
            delete this.collapseStates[id];

            actuallyRemoved.push(id);
        }

        const delay = animated ? 350 : 0;
        // ✅ 改动：使用 TimerManager
        this.timers.setTimeout(() => this.checkEmpty(), delay);

        return actuallyRemoved;
    }

    /**
     * ✅ 修复问题3：获取 prev/next agent chat 的导航目标
     * 
     * 导航逻辑：
     * - prev: 
     *   1. 找到当前可见 session 所属的 agent chat (assistant session)
     *   2. 如果该 agent chat 的 title 不在当前视口可见区域，则导航到该 title
     *   3. 否则导航到上一个未折叠的 agent chat 的 title
     * 
     * - next:
     *   1. 找到当前可见 session 所属的 agent chat
     *   2. 如果该 agent chat 的 title 不在视口中，先导航到该 title
     *   3. 否则导航到下一个未折叠的 agent chat 的 title
     *   4. 如果已经是最后一个，返回 '__end__' 表示应滚动到底部
     * 
     * @param currentVisibleId 当前视口中可见的 session ID
     * @param direction 'prev' | 'next'
     * @returns 目标 session ID，'__end__' 表示滚到底部，null 表示无目标
     */
    public getNeighborAgentChatTarget(
        currentVisibleId: string | null,
        direction: 'prev' | 'next'
    ): string | null | '__end__' {
        const sessions = Array.from(this.container.querySelectorAll('.llm-ui-session'));
        if (sessions.length === 0) return null;

        // 收集所有未折叠的 assistant session（agent chat）
        const agentSessions = sessions.filter(el => {
            if (!el.classList.contains('llm-ui-session--assistant')) return false;

            const sessionId = (el as HTMLElement).dataset.sessionId;
            if (!sessionId) return false;

            // 检查是否折叠：通过 collapseStates 或 DOM class
            const isCollapsed = this.collapseStates[sessionId] === true;
            return !isCollapsed;
        });

        if (agentSessions.length === 0) return null;

        // 找到当前可见 session 在全部 sessions 中的位置
        let currentIndex = -1;
        if (currentVisibleId) {
            currentIndex = sessions.findIndex(
                el => (el as HTMLElement).dataset.sessionId === currentVisibleId
            );
        }

        // 找到当前可见 session 所属的 agent chat（即距离当前位置最近的前方 assistant session）
        let currentAgentSession: Element | null = null;
        let currentAgentIndex = -1;

        if (currentIndex >= 0) {
            // 检查当前 session 本身是否是 assistant
            if (sessions[currentIndex].classList.contains('llm-ui-session--assistant')) {
                currentAgentSession = sessions[currentIndex];
                currentAgentIndex = agentSessions.indexOf(currentAgentSession);
            } else {
                // 向前查找最近的 assistant session
                for (let i = currentIndex - 1; i >= 0; i--) {
                    if (sessions[i].classList.contains('llm-ui-session--assistant')) {
                        currentAgentSession = sessions[i];
                        currentAgentIndex = agentSessions.indexOf(currentAgentSession);
                        break;
                    }
                }
                // 如果前面没有 assistant，也检查后面（用户可能在第一条 user 消息处）
                if (!currentAgentSession) {
                    for (let i = currentIndex + 1; i < sessions.length; i++) {
                        if (sessions[i].classList.contains('llm-ui-session--assistant')) {
                            currentAgentSession = sessions[i];
                            currentAgentIndex = agentSessions.indexOf(currentAgentSession);
                            break;
                        }
                    }
                }
            }
        }

        // 检查某个 session 的 title（header）是否在视口中可见
        const isTitleVisible = (sessionEl: Element): boolean => {
            const header = sessionEl.querySelector('.llm-ui-node__header, .llm-ui-bubble__header');
            if (!header) return false;

            const containerRect = this.container.getBoundingClientRect();
            const headerRect = header.getBoundingClientRect();

            // title 可见 = header 的顶部在容器可视区域内
            return headerRect.top >= containerRect.top &&
                headerRect.top <= containerRect.bottom;
        };

        if (direction === 'prev') {
            // 如果当前有关联的 agent chat 且其 title 不可见，先跳到它的 title
            if (currentAgentSession && !isTitleVisible(currentAgentSession)) {
                const sessionId = (currentAgentSession as HTMLElement).dataset.sessionId;
                return sessionId || null;
            }

            // 否则找上一个未折叠的 agent chat
            if (currentAgentIndex > 0) {
                const prevAgent = agentSessions[currentAgentIndex - 1];
                return (prevAgent as HTMLElement).dataset.sessionId || null;
            } else if (currentAgentIndex === -1 && agentSessions.length > 0) {
                // 当前不在任何 agent chat 中，导航到最后一个
                const lastAgent = agentSessions[agentSessions.length - 1];
                return (lastAgent as HTMLElement).dataset.sessionId || null;
            }

            return null;
        } else {
            // direction === 'next'

            // 如果当前有关联的 agent chat 且其 title 不可见（用户在该 chat 的中间位置向下看）
            // 这种情况下 next 应该跳到下一个，因为用户已经看过当前的内容了
            // 但如果 title 在视口上方（已经滚过去了），next 应该跳到下一个

            if (currentAgentIndex >= 0) {
                // 找下一个未折叠的 agent chat
                if (currentAgentIndex < agentSessions.length - 1) {
                    const nextAgent = agentSessions[currentAgentIndex + 1];
                    return (nextAgent as HTMLElement).dataset.sessionId || null;
                } else {
                    // 已经是最后一个 agent chat，跳到 chat 末尾
                    return '__end__';
                }
            } else if (agentSessions.length > 0) {
                // 当前不在任何 agent chat 中（比如在第一条 user 消息之前）
                // 导航到第一个 agent chat
                const firstAgent = agentSessions[0];
                return (firstAgent as HTMLElement).dataset.sessionId || null;
            }

            return null;
        }
    }

    // ================================================================
    // 渲染
    // ================================================================

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
            this.timers.setTimeout(() => {
                if (banner.parentNode) banner.remove();
            }, 5000);
        }

        this.container.insertBefore(banner, this.container.firstChild);
        this.scrollController.scrollToBottom(true);
    }

    // ================================================================
    // 滚动（委托给 ScrollController）
    // ================================================================

    /**
     * 滚动到底部
     * 
     * @param force - 
     *   true:  用户主动触发（如点击按钮、发送消息）→ 使用 forceScrollToBottom
     *   false: 程序触发（如新内容到达）→ 尊重用户滚动状态
     */
    scrollToBottom(force: boolean = false): void {
        if (force) {
            this.scrollController.forceScrollToBottom();
        } else {
            this.scrollController.scrollToBottom(false);
        }
    }

    /**
     * 进入流式输出模式
     */
    public enterStreamingMode(): void {
        if (this.isStreamingMode) return;

        this.isStreamingMode = true;
        this.scrollController.enterStreamingMode();
        this.resizeTracker.enterStreamingMode();
        this.container.classList.add('llm-ui-history--streaming');
    }

    /**
     * ✅ 优化：退出流式输出模式（智能滚动）
     */
    public exitStreamingMode(): void {
        if (!this.isStreamingMode) return;

        this.isStreamingMode = false;
        this.scrollController.exitStreamingMode();
        this.resizeTracker.exitStreamingMode();
        this.container.classList.remove('llm-ui-history--streaming');

        if (!this.scrollController.isUserScrolledUp) {
            this.scrollController.scrollToBottom(true);
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

    // ================================================================
    // 新内容提示器
    // ================================================================

    private showNewContentIndicator(): void {
        // 避免重复创建
        if (this.newContentIndicator) return;

        this.newContentIndicator = document.createElement('div');
        this.newContentIndicator.className = 'llm-ui-new-content-indicator';
        this.newContentIndicator.innerHTML = ErrorTemplates.renderNewContentIndicator();

        this.newContentIndicator.querySelector('button')?.addEventListener('click', () => {
            // ✅ 修复：使用 forceScrollToBottom，明确的用户操作
            this.scrollController.forceScrollToBottom();
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

    // ================================================================
    // Session / Node 渲染
    // ================================================================

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
        // ✅ 改动：事件绑定已由事件委托处理，不再需要 bindUserBubbleEvents
    }

    private renderExecutionTree(node: ExecutionNode, isCollapsed: boolean = false) {
        this.appendNode(node.parentId, node, isCollapsed);
        node.children?.forEach(c => this.renderExecutionTree(c, isCollapsed));
    }

    private appendNode(parentId: string | undefined, node: ExecutionNode, isCollapsed: boolean) {
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
            const { element } = NodeRenderer.create(node);

            if (isCollapsed) {
                element.classList.add('is-collapsed');
                const svg = element.querySelector('[data-action="collapse"] svg');
                if (svg) svg.innerHTML = '<polyline points="6 9 12 15 18 9"></polyline>';
            }

            this.nodeMap.set(node.id, element);
            parentEl.appendChild(element);

            // ✅ 改动：简化为仅编辑器挂载（事件由委托处理）
            this.mountNodeEditor(element, node);
        }
    }

    // ✅ 新增：仅负责编辑器挂载（替代原来的 bindNodeEvents）
    private mountNodeEditor(element: HTMLElement, node: ExecutionNode): void {
        const getSessionId = (): string => {
            const sessionEl = element.closest('[data-session-id]');
            return (sessionEl as HTMLElement)?.dataset.sessionId || node.id;
        };
        const effectiveId = getSessionId();

        const mountPoint = element.querySelector(`#mount-${node.id}`) as HTMLElement;
        if (!mountPoint) return;

        const isStreamingNode = node.status === 'running' || node.status === 'queued';

        const controller = new MDxController(mountPoint, node.data.output || '', {
            readOnly: true,
            streaming: isStreamingNode,
            onChange: (text) => {
                if (controller.isEditing()) {
                    this.onContentChange?.(effectiveId, text, 'node');
                }
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

        // 设置 agentId 用于事件委托中的 icon 点击
        const iconEl = element.querySelector('.llm-ui-node__icon--clickable');
        if (iconEl && node.data.metaInfo?.agentId) {
            (iconEl as HTMLElement).dataset.agentId = node.data.metaInfo.agentId;
        }
    }

    // ================================================================
    // 编辑操作
    // ================================================================

    private toggleEditMode(
        nodeId: string,
        controller: MDxController,
        actionsEl: HTMLElement,
        wrapper: HTMLElement
    ) {
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
            this.timers.setTimeout(() => {
                btnElement.innerHTML = originalHtml;
            }, 1500);
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

    // ================================================================
    // 折叠控制
    // ================================================================

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
                // ✅ 改动：通过 bus 通知，替代直接回调
                this.bus?.emit('state:collapseChanged', { states: { ...this.collapseStates } });
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
                    await controller.collapseBlocks();
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

    // ================================================================
    // 公开的代码块折叠方法
    // ================================================================

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

    public getNeighborAgentSessionId(
        currentVisibleId: string | null,
        direction: 'next' | 'prev'
    ): string | null {
        const result = this.getNeighborAgentChatTarget(currentVisibleId, direction);
        if (result === '__end__') return null;
        return result;
    }

    // ================================================================
    // 节点内容更新
    // ================================================================

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
                    this.timers.requestAnimationFrame(() => {
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

    // ================================================================
    // 事件处理（使用 EventBatchProcessor）
    // ================================================================

    // ✅ 改动：统一入口委托给 EventBatchProcessor
    processEvent(event: OrchestratorEvent) {
        this.eventProcessor.push(event);
    }

    // ✅ 新增：处理合并后的批量事件
    private handleBatchedEvents(batched: BatchedEvents): void {
        // 1. 先应用合并的 chunk
        for (const [nodeId, chunks] of batched.chunks) {
            if (chunks.thought) {
                this.updateNodeContent(nodeId, chunks.thought, 'thought');
            }
            if (chunks.output) {
                this.updateNodeContent(nodeId, chunks.output, 'output');
            }
        }

        // 2. 再处理状态变更
        for (const [nodeId, { status, result }] of batched.statusChanges) {
            this.updateNodeStatus(nodeId, status, result);
        }

        // 3. 最后处理不可合并的事件
        for (const event of batched.immediate) {
            this.processEventImmediate(event);
        }

    }

    private processEventImmediate(event: OrchestratorEvent) {
        switch (event.type) {
            case 'branch_switched':
                this.collapseStates = {};
                return;

            case 'branch_created':
                return;

            case 'branch_renamed':
                this.handleBranchRenamed(event.payload);
                return;

            case 'branch_deleted':
                this.handleBranchDeleted(event.payload);
                return;

            case 'session_start':
                this.clearErrors();
                this.enterStreamingMode();
                const isUser = event.payload.role === 'user';
                const defaultFold = isUser ? true : false;
                this.appendSessionGroup(event.payload, defaultFold);
                this.collapseStates[event.payload.id] = defaultFold;

                // ✅ 修复：只在用户当前在底部时滚动
                // force=false 让 ScrollController 内部判断
                this.scrollController.scrollToBottom(false);
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
                this.exitStreamingMode();
                this.editorMap.forEach(editor => editor.finishStream());
                this.clearErrors();
                this.bus?.emit('state:collapseChanged', { states: { ...this.collapseStates } });
                break;

            case 'error': {
                this.exitStreamingMode();
                const errorMessage = event.payload.message || 'Unknown error';
                const errorCode = (event.payload as any).code;

                if (errorCode === 401) {
                    this.appendErrorBubble(new Error(`🔐 ${errorMessage}`));
                } else if (errorCode === 429) {
                    this.appendErrorBubble(new Error(`⏳ ${errorMessage}`));
                } else {
                    this.appendErrorBubble(new Error(errorMessage));
                }
                this.editorMap.forEach(editor => editor.finishStream(false));
                break;
            }

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
                this.clearErrors();
                this.enterStreamingMode();
                break;
        }
    }

    // ================================================================
    // 事件子处理器
    // ================================================================

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

    private handleBranchRenamed(payload: { nodeId: string; newName: string }): void {
        const el = this.container.querySelector(`[data-session-id="${payload.nodeId}"]`) as HTMLElement ||
            this.nodeMap.get(payload.nodeId) || null;
        if (el) {
            const nameEl = el.querySelector('.llm-branch-name');
            if (nameEl) {
                nameEl.textContent = payload.newName;
            }
        }
    }

    private handleBranchDeleted(payload: { deletedIds: string[] }): void {
        this.removeMessages(payload.deletedIds, true);
    }

    // ================================================================
    // Error Bubble
    // ================================================================

    public appendErrorBubble(error: Error) {
        this.exitStreamingMode();

        const wrapper = document.createElement('div');
        wrapper.className = 'llm-ui-session llm-ui-session--system';

        const isAuthError = error.message.includes('apiKey') || error.message.includes('401');
        wrapper.innerHTML = ErrorTemplates.renderErrorBubble(error.message, isAuthError);

        this.container.appendChild(wrapper);
        this.scrollController.scrollToBottom(true);

        // ✅ 改动：事件委托已处理 data-action="open-settings" 和 data-action="retry-last"
        // 不需要在此处绑定事件
    }

    private findLastRetryableId(): string | null {
        const allSessions = Array.from(this.container.querySelectorAll('[data-session-id]'));
        if (allSessions.length > 0) {
            return (allSessions[allSessions.length - 1] as HTMLElement).dataset.sessionId || null;
        }
        return null;
    }

    // ================================================================
    // 工具方法
    // ================================================================

    private getPreviewText(content: string): string {
        if (!content) return '';
        let plain = content.replace(/[\r\n]+/g, ' ');
        plain = plain.replace(/[*#`_~[\]()]/g, '');
        plain = plain.trim();
        if (!plain) return '';
        return plain.length > 60 ? plain.substring(0, 60) + '...' : plain;
    }

    // ✅ 改动：使用 TimerManager 管理动画定时器
    private removeElement(el: HTMLElement, animated: boolean): void {
        if (animated) {
            el.classList.add('llm-ui-session--deleting');
            el.addEventListener('animationend', () => el.remove(), { once: true });
            this.timers.setTimeout(() => {
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

    // ================================================================
    // 清理
    // ================================================================

    clear() {
        this.previewUpdateTimers.forEach(timer => clearTimeout(timer));
        this.previewUpdateTimers.clear();

        this.editorMap.forEach(editor => editor.destroy());
        this.editorMap.clear();

        this.nodeMap.clear();
        this.originalContentMap.clear();
        this.editingNodes.clear();
        this.renderedSessionIds.clear();

        this.isStreamingMode = false;
        this.container.classList.remove('llm-ui-history--streaming');

        this.container.innerHTML = '';
    }

    destroy() {
        // ✅ 改动：统一清理所有子系统
        this.timers.destroy();
        this.events.cleanup();
        this.eventProcessor.destroy();
        this.scrollController.destroy();
        this.resizeTracker.destroy();

        this.previewUpdateTimers.forEach(timer => clearTimeout(timer));
        this.previewUpdateTimers.clear();

        this.editorMap.forEach(editor => editor.destroy());
        this.editorMap.clear();

        this.nodeMap.clear();
        this.originalContentMap.clear();
        this.editingNodes.clear();
        this.collapseStates = {};
        this.renderedSessionIds.clear();

        this.isStreamingMode = false;
        this.container.classList.remove('llm-ui-history--streaming');

        this.hideNewContentIndicator();

        this.container.innerHTML = '';
    }
}
