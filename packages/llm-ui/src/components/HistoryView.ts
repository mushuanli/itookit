// @file: llm-ui/components/history/HistoryView.ts

import type { SessionGroup, OrchestratorEvent } from '@itookit/llm-engine';
import type { ISessionEngine } from '@itookit/common';
import type { IHistoryPresenter } from '../domain/ports/IHistoryPresenter';
import type { CollapseStateMap, NodeActionCallback } from '../domain/types';
import type { IEditorEventBus } from '../domain/events';
import {
    ScrollController, ContentResizeTracker, EventBatchProcessor,
    TimerManager, BatchedEvents,
} from './common';
import { ErrorTemplates } from './templates/ErrorTemplates';
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
    bus?: IEditorEventBus;
    nodeId?: string;
    ownerNodeId?: string;
    sessionEngine?: ISessionEngine;
    initialCollapseStates?: CollapseStateMap;
    onScroll?: () => void;
}

/**
 * HistoryView — 实现 IHistoryPresenter
 *
 * Shell 通过 IHistoryPresenter 接口交互，
 * 内部细节（5 个子控制器）完全封装。
 */
export class HistoryView implements IHistoryPresenter {
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
    private eventProcessor: EventBatchProcessor<OrchestratorEvent>;
    private timers = new TimerManager();

    private newContentIndicator: HTMLElement | null = null;
    private bus?: IEditorEventBus;
    private suppressScrollHighlight = false;

    constructor(container: HTMLElement, options: HistoryViewOptions) {
        this.container = container;
        this.bus = options.bus;

        const ctx: RendererContext = {
            nodeId: options.nodeId,
            ownerNodeId: options.ownerNodeId,
            sessionEngine: options.sessionEngine,
        };

        this.renderer = new SessionRenderer(container, ctx, options.onContentChange);

        this.scrollController = new ScrollController(container, {
            onUserScrolledUp: () => this.showNewContentIndicator(),
            onUserScrolledDown: () => this.hideNewContentIndicator(),
            onScroll: () => {
                if (!this.suppressScrollHighlight) {
                    options.onScroll?.();
                }
            },
        });

        this.stream = new StreamController(container, this.renderer, this.scrollController);

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

        this.resizeTracker = new ContentResizeTracker(
            container,
            (newH, oldH) => {
                if (newH > oldH
                    && !this.stream.isStreamingMode
                    && !this.stream.recentlyExited) {
                    this.scrollController.handleContentResize();
                }
            }
        );

        // ✅ 使用泛化的 EventBatchProcessor
        this.eventProcessor = new EventBatchProcessor<OrchestratorEvent>(
            (batched) => this.handleBatchedEvents(batched),
            (event) => this.processEventImmediate(event),
            {
                interval: 50,
                immediateTypes: [
                    'session_start', 'finished', 'error', 'session_cleared',
                    'messages_deleted', 'message_edited',
                    'regenerate_started', 'regenerate_completed',
                    'branch_switched', 'branch_created', 'branch_renamed', 'branch_deleted',
                    'sibling_switch',
                ],
            }
        );
    }

    // ================================================================
    // IHistoryPresenter 实现
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
        this.container.querySelector('.llm-ui-error-banner')?.remove();

        const banner = document.createElement('div');
        banner.className = 'llm-ui-error-banner';
        banner.innerHTML = ErrorTemplates.renderErrorBanner(error.message);

        banner.querySelector('.llm-ui-error-banner__close')?.addEventListener('click', () => {
            banner.remove();
        });

        const isSerious = error.message.includes('401') || error.message.includes('API key');
        if (!isSerious) {
            this.timers.setTimeout(() => { if (banner.parentNode) banner.remove(); }, 5000);
        }

        this.container.insertBefore(banner, this.container.firstChild);
        this.scrollController.scrollToBottom(true);
    }

    clearErrors(): void {
        this.container.querySelectorAll('.llm-ui-error-banner').forEach(el => el.remove());
        this.container.querySelectorAll('.llm-ui-session--system').forEach(el => el.remove());
    }

    removeMessages(ids: string[], animated: boolean): string[] {
        for (const id of ids) {
            this.edit.cleanup(id);
            this.stream.cleanupNode(id);
        }
        return this.renderer.removeMessages(ids, animated);
    }

    getCollapseStates(): CollapseStateMap {
        return this.collapse.getStates();
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

    toggleAllFold(): boolean {
        return this.collapse.toggleAll();
    }

    shouldShowCollapseIcon(): boolean {
        return this.collapse.shouldCollapse();
    }

    foldFirstUnfolded(): void {
        this.collapse.foldFirstUnfolded();
    }

    scrollToBottom(force: boolean = false): void {
        if (force) {
            this.scrollController.forceScrollToBottom();
        } else {
            this.scrollController.scrollToBottom(false);
        }
    }

    enterStreamingMode(): void {
        this.stream.enter();
        this.suppressScrollHighlight = true;
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

    getSessionElement(sessionId: string): HTMLElement | null {
        return this.renderer.getSessionElement(sessionId);
    }

    getAgentNavigationTarget(
        direction: 'prev' | 'next'
    ): string | null | '__end__' | '__start__' {
        const collapseStates = this.collapse.getStates();

        // 一次性读取容器位置
        const containerRect = this.container.getBoundingClientRect();
        const viewportTop = containerRect.top;
        const viewportBottom = containerRect.bottom;
        const TITLE_HEIGHT = 48;

        const allSessions = this.container.querySelectorAll('.llm-ui-session--assistant');
        if (allSessions.length === 0) return null;

        // 转为数组以支持反向遍历
        const sessionArray = Array.from(allSessions) as HTMLElement[];

        if (direction === 'prev') {
            return this.findPrevAgent(sessionArray, collapseStates, viewportTop, viewportBottom, TITLE_HEIGHT);
        } else {
            return this.findNextAgent(sessionArray, collapseStates, viewportTop, viewportBottom, TITLE_HEIGHT);
        }
    }

    /**
     * 向前导航：找到视口上方最近的 agent，或当前 agent 本身（如果标题被遮挡）
     */
    private findPrevAgent(
        sessions: HTMLElement[],
        collapseStates: Record<string, boolean>,
        viewportTop: number,
        _viewportBottom: number,
        titleHeight: number
    ): string | null | '__start__' {
        let lastAboveId: string | null = null;

        for (const el of sessions) {
            const id = el.dataset.sessionId;
            if (!id || collapseStates[id]) continue;

            const rect = el.getBoundingClientRect();
            const titleBottom = rect.top + titleHeight;

            // 情况 1：标题完全在视口上方 → 记录为候选
            if (titleBottom < viewportTop) {
                lastAboveId = id;
                continue;
            }

            // 情况 2：元素跨越视口顶部（标题被遮挡）→ 直接返回它
            if (rect.top < viewportTop && rect.bottom > viewportTop) {
                return id;
            }

            // 情况 3：元素在视口内或下方 → 停止搜索
            // 因为我们是正向遍历，后面的元素只会更靠下
            break;
        }

        // 如果找到了上方的 agent，返回它
        if (lastAboveId) return lastAboveId;

        // 没有上方 agent，检查是否可以滚动到顶部
        return this.container.scrollTop > 0 ? '__start__' : null;
    }

    /**
     * 向后导航：找到视口下方最近的 agent，或最后一个视口内 agent 之后的
     */
    private findNextAgent(
        sessions: HTMLElement[],
        collapseStates: Record<string, boolean>,
        viewportTop: number,
        viewportBottom: number,
        titleHeight: number
    ): string | null | '__end__' {
        //let lastInViewportId: string | null = null;
        let foundInViewport = false;

        for (const el of sessions) {
            const id = el.dataset.sessionId;
            if (!id || collapseStates[id]) continue;

            const rect = el.getBoundingClientRect();
            const titleBottom = rect.top + titleHeight;

            // 元素完全在视口上方 → 跳过
            if (rect.bottom < viewportTop) continue;

            // 元素在视口下方 → 这就是目标
            if (rect.top > viewportBottom) {
                return id;
            }

            // 元素在视口内（部分或全部）
            if (titleBottom >= viewportTop && rect.top <= viewportBottom) {
                foundInViewport = true;
                //lastInViewportId = id;
            }
        }

        // 遍历完了，没有找到视口下方的 agent
        // 如果有视口内的 agent，说明已经是最后一个了
        if (foundInViewport) {
            return '__end__';
        }

        return null;
    }

    processEvent(event: OrchestratorEvent): void {
        this.eventProcessor.push(event);
    }

    // ================================================================
    // 内部事件处理
    // ================================================================

    private handleBatchedEvents(batched: BatchedEvents<OrchestratorEvent>): void {
        for (const [nodeId, chunks] of batched.chunks) {
            if (chunks.thought) this.stream.updateContent(nodeId, chunks.thought, 'thought');
            if (chunks.output) this.stream.updateContent(nodeId, chunks.output, 'output');
        }

        for (const [nodeId, { status, result }] of batched.statusChanges) {
            this.stream.updateStatus(nodeId, status, result);
        }

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
                this.renderer.appendSession(event.payload, isUser);
                this.collapse.setState(event.payload.id, isUser);
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
                const el = this.renderer.getSessionElement(event.payload.messageId);
                if (el) {
                    const preview = el.querySelector('.llm-ui-header-preview');
                    if (preview) {
                        preview.textContent = getPreviewText(event.payload.newContent);
                    }
                }
                break;
            }

            case 'session_cleared':
                this.renderer.renderWelcome();
                break;

            case 'sibling_switch': {
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

            case 'regenerate_started':
                this.clearErrors();
                this.enterStreamingMode();
                break;

            case 'regenerate_completed':
                break;
        }
    }

    // ================================================================
    // 内部辅助
    // ================================================================

    private appendErrorBubble(error: Error): void {
        this.stream.exit();

        const wrapper = document.createElement('div');
        wrapper.className = 'llm-ui-session llm-ui-session--system';

        const isAuthError = error.message.includes('apiKey') || error.message.includes('401');
        wrapper.innerHTML = ErrorTemplates.renderErrorBubble(error.message, isAuthError);

        this.container.appendChild(wrapper);
        this.scrollController.scrollToBottom(true);
    }

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

    private clear(): void {
        this.stream.destroy();
        this.edit.destroy();
        this.renderer.clear();
        this.stream = new StreamController(this.container, this.renderer, this.scrollController);
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
