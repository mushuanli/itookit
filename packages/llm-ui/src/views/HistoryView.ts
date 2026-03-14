// @file: llm-ui/views/HistoryView.ts

import { SessionGroup, OrchestratorEvent } from '@itookit/llm-engine';
import { ISessionEngine } from '@itookit/common';
import { CollapseStateMap, NodeActionCallback } from '../base/core/types';
import { EditorEventBus } from '../base/core/EditorEventBus';
import { ScrollController } from './common/ScrollController';
import { ContentResizeTracker } from './common/ContentResizeTracker';
import { EventBatchProcessor, BatchedEvents } from './common/EventBatchProcessor';
import { ErrorTemplates } from './templates/ErrorTemplates';
import { TimerManager } from './common/TimerManager';
import { getPreviewText } from '../utils/textUtils';

import { SessionRenderer, RendererContext } from './history/SessionRenderer';
import { StreamController } from './history/StreamController';
import { CollapseController } from './history/CollapseController';
import { EditController } from './history/EditController';
import { EventDispatcher } from './history/EventDispatcher';

export interface HistoryViewOptions {
    onContentChange?: (id: string, content: string, type: 'user' | 'node') => void;
    onNodeAction?: NodeActionCallback;
    onCommitEdit?: (id: string, content: string) => void;
    bus?: EditorEventBus;
    nodeId?: string;
    ownerNodeId?: string;
    sessionEngine?: ISessionEngine;
    initialCollapseStates?: CollapseStateMap;
    onScroll?: () => void;
}

/**
 * HistoryView — Facade
 *
 * 对外暴露 HistoryView 的完整 API，内部委托给 5 个子控制器。
 * 自身只负责：
 * 1. 组装子控制器
 * 2. 管理滚动和内容高度追踪
 * 3. 处理引擎事件分发
 * 4. 错误渲染和新内容提示器
 */
export class HistoryView {
    private container: HTMLElement;

    // 子控制器
    private renderer: SessionRenderer;
    private stream: StreamController;
    private collapse: CollapseController;
    private edit: EditController;
    private dispatcher: EventDispatcher;

    // 基础设施
    private scrollController: ScrollController;
    private resizeTracker: ContentResizeTracker;
    private eventProcessor: EventBatchProcessor;
    private timers = new TimerManager();

    // UI 状态
    private newContentIndicator: HTMLElement | null = null;
    private bus?: EditorEventBus;

    // ✅ 新增：追踪流式期间是否需要抑制 onScroll
    private suppressScrollHighlight = false;

    constructor(container: HTMLElement, options: HistoryViewOptions) {
        this.container = container;
        this.bus = options.bus;

        // 1. 创建 Renderer
        const ctx: RendererContext = {
            nodeId: options.nodeId,
            ownerNodeId: options.ownerNodeId,
            sessionEngine: options.sessionEngine,
        };

        this.renderer = new SessionRenderer(
            container, ctx, options.onContentChange
        );

        // 2. 滚动控制器
        this.scrollController = new ScrollController(container, {
            onUserScrolledUp: () => this.showNewContentIndicator(),
            onUserScrolledDown: () => this.hideNewContentIndicator(),
            onScroll: () => {
                // ✅ 流式期间抑制高亮更新，避免无意义的 DOM 查询
                if (!this.suppressScrollHighlight) {
                    options.onScroll?.();
                }
            },
        });

        // 3. 创建子控制器（StreamController 接收 scrollController）
        this.stream = new StreamController(
            container, this.renderer, this.scrollController
        );

        this.collapse = new CollapseController(
            container, this.renderer, options.bus, options.initialCollapseStates
        );

        this.edit = new EditController(
            options.onContentChange,
            options.onNodeAction,
            options.onCommitEdit,
        );

        this.dispatcher = new EventDispatcher(
            container, this.renderer, this.stream,
            this.collapse, this.edit, options.bus, options.onNodeAction,
        );

        // 4. ContentResizeTracker — 仅非流式期间使用
        // ✅ 流式期间由 StreamRenderPipeline 接管高度检查
        this.resizeTracker = new ContentResizeTracker(
            container,
            (newH, oldH) => {
                if (newH > oldH && !this.stream.isStreamingMode) {
                    this.scrollController.handleContentResize();
                }
            }
        );

        // 5. 事件批处理
        this.eventProcessor = new EventBatchProcessor(
            (batched) => this.handleBatchedEvents(batched),
            (event) => this.processEventImmediate(event),
            50
        );
    }

    // ================================================================
    // 公开 API — 渲染
    // ================================================================

    renderFull(sessions: SessionGroup[]): void {
        this.clear();
        if (sessions.length === 0) {
            this.renderer.renderWelcome();
            return;
        }

        const totalCount = sessions.length;

        sessions.forEach((session, index) => {
            const shouldCollapse = this.collapse.computeInitialState(
                session.id, session.role, index, totalCount
            );

            this.renderer.appendSession(session, shouldCollapse);

            if (session.executionRoot) {
                this.renderer.renderExecutionTree(session.executionRoot, shouldCollapse);
            }
        });

        this.scrollToBottom(true);
    }

    renderWelcome(): void {
        this.renderer.renderWelcome();
    }

    renderError(error: Error): void {
        // 清理已有 banner
        this.container.querySelector('.llm-ui-error-banner')?.remove();

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

    clearErrors(): void {
        this.container.querySelectorAll('.llm-ui-error-banner').forEach(el => el.remove());
        this.container.querySelectorAll('.llm-ui-session--system').forEach(el => el.remove());
    }

    appendErrorBubble(error: Error): void {
        this.stream.exit();

        const wrapper = document.createElement('div');
        wrapper.className = 'llm-ui-session llm-ui-session--system';

        const isAuthError = error.message.includes('apiKey') || error.message.includes('401');
        wrapper.innerHTML = ErrorTemplates.renderErrorBubble(error.message, isAuthError);

        this.container.appendChild(wrapper);
        this.scrollController.scrollToBottom(true);
    }

    // ================================================================
    // 公开 API — 消息操作
    // ================================================================

    removeMessages(ids: string[], animated: boolean): string[] {
        for (const id of ids) {
            this.edit.cleanup(id);
            this.stream.cleanupNode(id);
        }
        return this.renderer.removeMessages(ids, animated);
    }

    // ================================================================
    // 公开 API — 折叠
    // ================================================================

    getCollapseStates(): CollapseStateMap {
        return this.collapse.getStates();
    }

    setCollapseStates(states: CollapseStateMap): void {
        this.collapse = new CollapseController(
            this.container, this.renderer, this.bus,
            states
        );
    }

    toggleSessionCollapse(sessionId: string, forceState?: boolean): void {
        const expanded = this.collapse.toggleSession(sessionId, forceState);
        if (expanded) {
            this.collapse.collapseCodeBlocksInSession(sessionId);
        }
    }

    setAllCollapsed(collapsed: boolean): void {
        this.collapse.setAllCollapsed(collapsed);
    }

    foldFirstUnfolded(): void {
        this.collapse.foldFirstUnfolded();
    }

    // ================================================================
    // 公开 API — 代码块
    // ================================================================

    async collapseCodeBlocksForSession(sessionId: string): Promise<void> {
        await this.collapse.collapseCodeBlocksInSession(sessionId);
    }

    async expandCodeBlocksForSession(sessionId: string): Promise<void> {
        const ids = this.renderer.getEditorIdsForSession(sessionId);
        await Promise.all(ids.map(async (id) => {
            const ctrl = this.renderer.getEditor(id);
            if (ctrl) {
                try {
                    await ctrl.waitUntilReady();
                    await ctrl.expandBlocks();
                } catch (e) {
                    console.warn(`[HistoryView] Expand failed: ${id}`, e);
                }
            }
        }));
    }

    async collapseAllCodeBlocks(): Promise<void> {
        await this.collapse.batchCodeBlockAction('collapse');
    }

    async expandAllCodeBlocks(): Promise<void> {
        await this.collapse.batchCodeBlockAction('expand');
    }

    // ================================================================
    // 公开 API — 流式
    // ================================================================

    enterStreamingMode(): void {
        this.stream.enter();
        this.suppressScrollHighlight = true;

        // ✅ 不再需要通知 resizeTracker 进入流式模式
        // Pipeline 已接管高度检查
    }

    exitStreamingMode(): void {
        this.stream.exit();
        this.suppressScrollHighlight = false;

        if (!this.scrollController.isUserScrolledUp) {
            this.scrollController.scrollToBottom(true);
        } else {
            this.showNewContentIndicator();
        }
    }

    // ================================================================
    // 公开 API — 智能折叠
    // ================================================================

    /**
     * ✅ 智能切换全部折叠/展开
     * @returns true 如果操作后处于折叠状态
     */
    toggleAllFold(): boolean {
        return this.collapse.toggleAll();
    }

    /**
     * ✅ 查询当前是否有展开的 assistant 会话
     */
    shouldShowCollapseIcon(): boolean {
        return this.collapse.shouldCollapse();
    }

    // ================================================================
    // 公开 API — 滚动
    // ================================================================

    scrollToBottom(force: boolean = false): void {
        if (force) {
            this.scrollController.forceScrollToBottom();
        } else {
            this.scrollController.scrollToBottom(false);
        }
    }

    // ================================================================
    // 公开 API — 查询
    // ================================================================

    getSessionElement(sessionId: string): HTMLElement | null {
        return this.renderer.getSessionElement(sessionId);
    }

    getFirstUnfoldedAgentContent(): string | null {
        const sessions = Array.from(
            this.container.querySelectorAll('.llm-ui-session--assistant')
        );
        for (const session of sessions) {
            const nodes = session.querySelectorAll('.llm-ui-node');

            for (const node of nodes) {
                if (!node.classList.contains('is-collapsed')) {
                    const nodeId = (node as HTMLElement).dataset.id;
                    if (nodeId) {
                        const editor = this.renderer.getEditor(nodeId);
                        if (editor) return editor.content;
                    }
                }
            }
        }
        return null;
    }

    /**
 * 获取 agent chat 导航目标
 * 
 * 设计：跳转到视口外的 unfold agent chat 的 title 位置
 * - prev: 如果当前 agent chat 的 title 不在视口中，先跳到当前的 title；
 *         否则跳到上一个 unfold agent chat 的 title
 * - next: 跳到下一个 unfold agent chat 的 title；
 *         最后一个之后返回 '__end__'
 */
    getAgentNavigationTarget(
        direction: 'prev' | 'next'
    ): string | null | '__end__' | '__start__' {
        const containerRect = this.container.getBoundingClientRect();
        const viewportTop = containerRect.top;
        const viewportBottom = containerRect.bottom;

        // 收集所有 unfold 的 assistant session 元素
        const collapseStates = this.collapse.getStates();
        const agentElements: HTMLElement[] = [];

        const allSessions = this.container.querySelectorAll('.llm-ui-session--assistant');
        for (const el of allSessions) {
            const id = (el as HTMLElement).dataset.sessionId;
            if (id && !collapseStates[id]) {
                agentElements.push(el as HTMLElement);
            }
        }

        if (agentElements.length === 0) return null;

        // 判断每个 agent session 的 title 是否在视口中
        // title 就是 session 元素的顶部区域（包含 avatar 和 agent header）
        const TITLE_HEIGHT = 48; // agent chat title 大约的高度（像素）

        // 分类：title 在视口上方、视口中、视口下方的 agent chats
        const aboveViewport: HTMLElement[] = [];   // title 完全在视口上方
        const inViewport: HTMLElement[] = [];      // title 在视口中可见
        const belowViewport: HTMLElement[] = [];   // title 完全在视口下方

        for (const el of agentElements) {
            const rect = el.getBoundingClientRect();
            const titleBottom = rect.top + TITLE_HEIGHT;

            if (titleBottom < viewportTop) {
                // title 已经滚出视口上方
                aboveViewport.push(el);
            } else if (rect.top > viewportBottom) {
                // title 在视口下方
                belowViewport.push(el);
            } else {
                // title 至少部分可见
                inViewport.push(el);
            }
        }

        if (direction === 'prev') {
            // Case 1: 有 agent chat 的内容在视口中，但 title 不可见
            // 这种情况：session 的 body 在视口中，但 rect.top < viewportTop
            // 即 session 还在视口，但 title 已经滚出
            const currentlyViewingButTitleHidden = this.findAgentWithContentVisibleButTitleHidden(
                agentElements, viewportTop, viewportBottom, TITLE_HEIGHT
            );

            if (currentlyViewingButTitleHidden) {
                return currentlyViewingButTitleHidden.dataset.sessionId || null;
            }

            // Case 2: 当前视口中有 title 可见的 agent chat
            // 跳到 aboveViewport 中最后一个（最近的上方 agent）
            if (aboveViewport.length > 0) {
                return aboveViewport[aboveViewport.length - 1].dataset.sessionId || null;
            }

            // Case 3: 没有更上面的 agent 了
            // 检查是否已经在顶部
            if (this.container.scrollTop > 0) {
                return '__start__';  // ← 对称处理：跳到顶部
            }

            return null;  // 已经在顶部，Toast 提示
        } else {
            // next direction

            // Case 1: 视口下方有 agent chat → 跳到第一个
            if (belowViewport.length > 0) {
                return belowViewport[0].dataset.sessionId || null;
            }

            // Case 2: 视口中有多个 agent chat → 
            // 找到最后一个 title 可见的，如果它是整个列表的最后一个 → __end__
            // 这里需要考虑：视口中可能有一个 agent chat 的 title 可见
            // 但下方没有更多了

            // 检查当前视口中最后一个可见的 agent 是否是列表最后一个
            const lastInView = inViewport.length > 0
                ? inViewport[inViewport.length - 1]
                : null;
            const lastOverall = agentElements[agentElements.length - 1];

            if (lastInView === lastOverall ||
                (aboveViewport.length + inViewport.length === agentElements.length)) {
                return '__end__';
            }

            return null;
        }
    }

    /**
     * 查找"内容在视口中可见但 title 已滚出视口上方"的 agent chat
     */
    private findAgentWithContentVisibleButTitleHidden(
        agentElements: HTMLElement[],
        viewportTop: number,
        viewportBottom: number,
        titleHeight: number
    ): HTMLElement | null {
        for (const el of agentElements) {
            const rect = el.getBoundingClientRect();
            const titleBottom = rect.top + titleHeight;

            // title 在视口上方，但 session 的 body 还在视口中可见
            if (titleBottom < viewportTop && rect.bottom > viewportTop && rect.top < viewportBottom) {
                return el;
            }
        }
        return null;
    }


    // ================================================================
    // 事件处理（引擎事件入口）
    // ================================================================

    processEvent(event: OrchestratorEvent): void {
        this.eventProcessor.push(event);
    }

    private handleBatchedEvents(batched: BatchedEvents): void {
        // 1. 合并的 chunk — 通过 StreamController 积累
        for (const [nodeId, chunks] of batched.chunks) {
            if (chunks.thought) {
                this.stream.updateContent(nodeId, chunks.thought, 'thought');
            }
            if (chunks.output) {
                this.stream.updateContent(nodeId, chunks.output, 'output');
            }
        }

        // 2. 状态变更
        for (const [nodeId, { status, result }] of batched.statusChanges) {
            this.stream.updateStatus(nodeId, status, result);
        }

        // 3. 不可合并事件
        for (const event of batched.immediate) {
            this.processEventImmediate(event);
        }
    }

    private processEventImmediate(event: OrchestratorEvent): void {
        switch (event.type) {
            case 'branch_switched':
                this.collapse.resetStates();
                return;

            case 'branch_created':
                return;

            case 'branch_renamed': {
                const el = this.renderer.getSessionElement(event.payload.nodeId)
                    || this.renderer.getNode(event.payload.nodeId);
                if (el) {
                    const nameEl = el.querySelector('.llm-branch-name');
                    if (nameEl) nameEl.textContent = event.payload.newName;
                }
                return;
            }

            case 'branch_deleted':
                this.removeMessages(event.payload.deletedIds, true);
                return;

            case 'session_start': {
                this.clearErrors();
                this.enterStreamingMode();
                const isUser = event.payload.role === 'user';
                const defaultFold = isUser;
                this.renderer.appendSession(event.payload, defaultFold);
                this.collapse.setState(event.payload.id, defaultFold);
                this.scrollController.scrollToBottom(false);
                break;
            }

            case 'node_start':
                this.renderer.appendNode(event.payload.parentId, event.payload.node, false);
                break;

            case 'node_status':
                this.stream.updateStatus(
                    event.payload.nodeId, event.payload.status, event.payload.result
                );
                break;

            case 'finished':
                this.exitStreamingMode();
                this.renderer.editors.forEach(editor => editor.finishStream());
                this.clearErrors();
                this.bus?.emit('state:collapseChanged', {
                    states: this.collapse.getStates(),
                });
                break;

            case 'error': {
                this.exitStreamingMode();
                const msg = event.payload.message || 'Unknown error';
                const code = (event.payload as any).code;
                const prefix = code === 401 ? '🔐 ' : code === 429 ? '⏳ ' : '';
                this.appendErrorBubble(new Error(`${prefix}${msg}`));
                this.renderer.editors.forEach(editor => editor.finishStream(false));
                break;
            }

            case 'messages_deleted':
                this.removeMessages(event.payload.deletedIds, true);
                break;

            case 'message_edited': {
                // ✅ 更新：字段名从 sessionId 改为 messageId
                const el = this.renderer.getSessionElement(event.payload.messageId);
                if (el) {
                    const preview = el.querySelector('.llm-ui-header-preview');
                    if (preview) {
                        preview.textContent = getPreviewText(
                            event.payload.newContent
                        );
                    }
                }
                break;
            }

            case 'session_cleared':
                this.renderer.renderWelcome();
                break;

            case 'sibling_switch': {
                // ✅ 更新：字段名从 sessionId 改为 messageId
                const { messageId, newIndex, total } = event.payload;
                const el = this.renderer.getSessionElement(messageId);
                if (!el) break;

                const indicator = el.querySelector('.llm-ui-branch-indicator');
                if (indicator) indicator.textContent = `${newIndex + 1}/${total}`;

                const prevBtn = el.querySelector('[data-action="prev-sibling"]') as HTMLButtonElement;
                const nextBtn = el.querySelector('[data-action="next-sibling"]') as HTMLButtonElement;
                if (prevBtn) prevBtn.disabled = newIndex === 0;
                if (nextBtn) nextBtn.disabled = newIndex === total - 1;
                break;
            }

            // ✅ 新增：regenerate 事件处理
            case 'regenerate_started':
                this.clearErrors();
                this.enterStreamingMode();
                break;

            case 'regenerate_completed':
                // 完成事件在 SessionEventHandler 中处理分支刷新
                // HistoryView 不需要额外处理
                break;
        }
    }

    // ================================================================
    // 新内容提示器
    // ================================================================

    private showNewContentIndicator(): void {
        if (this.newContentIndicator) return;

        this.newContentIndicator = document.createElement('div');
        this.newContentIndicator.className = 'llm-ui-new-content-indicator';
        this.newContentIndicator.innerHTML = ErrorTemplates.renderNewContentIndicator();

        this.newContentIndicator.querySelector('button')?.addEventListener('click', () => {
            this.scrollController.forceScrollToBottom();
            this.hideNewContentIndicator();
        });

        this.container.appendChild(this.newContentIndicator);
    }

    private hideNewContentIndicator(): void {
        if (this.newContentIndicator) {
            this.newContentIndicator.remove();
            this.newContentIndicator = null;
        }
    }

    // ================================================================
    // 清理
    // ================================================================

    clear(): void {
        this.stream.destroy();
        this.edit.destroy();
        this.renderer.clear();

        // 重建 StreamController
        this.stream = new StreamController(
            this.container, this.renderer, this.scrollController
        );
    }

    destroy(): void {
        this.timers.destroy();
        this.eventProcessor.destroy();
        this.scrollController.destroy();
        this.resizeTracker.destroy();
        this.dispatcher.destroy();
        this.stream.destroy();
        this.collapse.destroy();
        this.edit.destroy();
        this.renderer.destroy();
        this.hideNewContentIndicator();
        this.container.innerHTML = '';
    }
}
