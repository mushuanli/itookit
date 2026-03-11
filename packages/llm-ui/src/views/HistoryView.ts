// @file: llm-ui/views/HistoryView.ts

import { SessionGroup, OrchestratorEvent } from '@itookit/llm-engine';
import { ISessionEngine } from '@itookit/common';
import { CollapseStateMap, NodeActionCallback } from '../base/core/types';
import { EditorEventBus } from '../base/core/EditorEventBus';
import { ScrollController } from '../base/infrastructure/ScrollController';
import { ContentResizeTracker } from '../base/infrastructure/ContentResizeTracker';
import { EventBatchProcessor, BatchedEvents } from '../base/infrastructure/EventBatchProcessor';
import { ErrorTemplates } from './templates/ErrorTemplates';
import { TimerManager } from '../base/infrastructure/TimerManager';

import { SessionRenderer, RendererContext } from './history/SessionRenderer';
import { StreamController } from './history/StreamController';
import { CollapseController } from './history/CollapseController';
import { EditController } from './history/EditController';
import { EventDispatcher } from './history/EventDispatcher';

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

    // 事件总线
    private bus?: EditorEventBus;

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

        // 2. 创建子控制器
        this.stream = new StreamController(container, this.renderer);

        this.collapse = new CollapseController(
            container, this.renderer, options.bus, options.initialCollapseStates
        );

        this.edit = new EditController(
            options.onContentChange, options.onNodeAction
        );

        this.dispatcher = new EventDispatcher(
            container,
            this.renderer,
            this.stream,
            this.collapse,
            this.edit,
            options.bus,
            options.onNodeAction,
        );

        // 3. 滚动 & 内容高度追踪
        this.scrollController = new ScrollController(container, {
            onUserScrolledUp: () => this.showNewContentIndicator(),
            onUserScrolledDown: () => this.hideNewContentIndicator(),
            onScroll: () => options.onScroll?.(),
        });

        // ✅ 改动：统一内容高度追踪
        this.resizeTracker = new ContentResizeTracker(
            container,
            (newH, oldH) => {
                if (newH > oldH) this.scrollController.handleContentResize();
            }
        );

        // ✅ 改动：统一事件批处理
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
        this.resizeTracker.enterStreamingMode();
    }

    exitStreamingMode(): void {
        this.stream.exit();
        this.resizeTracker.exitStreamingMode();

        if (!this.scrollController.isUserScrolledUp) {
            this.scrollController.scrollToBottom(true);
        } else {
            this.showNewContentIndicator();
        }
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
     * 获取相邻 agent chat 导航目标
     */
    getNeighborAgentChatTarget(
        currentVisibleId: string | null,
        direction: 'prev' | 'next'
    ): string | null | '__end__' {
        const sessions = Array.from(this.container.querySelectorAll('.llm-ui-session'));
        if (sessions.length === 0) return null;

        const collapseStates = this.collapse.getStates();

        // 收集未折叠的 assistant session
        const agentSessions = sessions.filter(el => {
            if (!el.classList.contains('llm-ui-session--assistant')) return false;
            const id = (el as HTMLElement).dataset.sessionId;
            return id ? !collapseStates[id] : false;
        });

        if (agentSessions.length === 0) return null;

        // 找到当前位置
        let currentIndex = -1;
        if (currentVisibleId) {
            currentIndex = sessions.findIndex(
                el => (el as HTMLElement).dataset.sessionId === currentVisibleId
            );
        }

        // 找到当前所属的 agent chat
        let currentAgentIndex = -1;
        if (currentIndex >= 0) {
            if (sessions[currentIndex].classList.contains('llm-ui-session--assistant')) {
                currentAgentIndex = agentSessions.indexOf(sessions[currentIndex]);
            } else {
                for (let i = currentIndex - 1; i >= 0; i--) {
                    if (sessions[i].classList.contains('llm-ui-session--assistant')) {
                        currentAgentIndex = agentSessions.indexOf(sessions[i]);
                        break;
                    }
                }
                if (currentAgentIndex === -1) {
                    for (let i = currentIndex + 1; i < sessions.length; i++) {
                        if (sessions[i].classList.contains('llm-ui-session--assistant')) {
                            currentAgentIndex = agentSessions.indexOf(sessions[i]);
                            break;
                        }
                    }
                }
            }
        }

        if (direction === 'prev') {
            if (currentAgentIndex > 0) {
                return (agentSessions[currentAgentIndex - 1] as HTMLElement).dataset.sessionId || null;
            } else if (currentAgentIndex === -1 && agentSessions.length > 0) {
                return (agentSessions[agentSessions.length - 1] as HTMLElement).dataset.sessionId || null;
            }
            return null;
        } else {
            if (currentAgentIndex >= 0 && currentAgentIndex < agentSessions.length - 1) {
                return (agentSessions[currentAgentIndex + 1] as HTMLElement).dataset.sessionId || null;
            } else if (currentAgentIndex === agentSessions.length - 1) {
                return '__end__';
            } else if (agentSessions.length > 0) {
                return (agentSessions[0] as HTMLElement).dataset.sessionId || null;
            }
            return null;
        }
    }

    getNeighborAgentSessionId(
        currentVisibleId: string | null,
        direction: 'next' | 'prev'
    ): string | null {
        const result = this.getNeighborAgentChatTarget(currentVisibleId, direction);
        return result === '__end__' ? null : result;
    }

    // ================================================================
    // 事件处理（引擎事件入口）
    // ================================================================

    processEvent(event: OrchestratorEvent): void {
        this.eventProcessor.push(event);
    }

    private handleBatchedEvents(batched: BatchedEvents): void {
        // 1. 合并的 chunk
        for (const [nodeId, chunks] of batched.chunks) {
            if (chunks.thought) this.stream.updateContent(nodeId, chunks.thought, 'thought');
            if (chunks.output) this.stream.updateContent(nodeId, chunks.output, 'output');
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
                const el = this.renderer.getSessionElement(event.payload.sessionId);
                if (el) {
                    const preview = el.querySelector('.llm-ui-header-preview');
                    if (preview) {
                        preview.textContent = this.renderer.getPreviewText(
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
                const { sessionId, newIndex, total } = event.payload;
                const el = this.renderer.getSessionElement(sessionId);
                if (!el) break;

                const indicator = el.querySelector('.llm-ui-branch-indicator');
                if (indicator) indicator.textContent = `${newIndex + 1}/${total}`;

                const prevBtn = el.querySelector('[data-action="prev-sibling"]') as HTMLButtonElement;
                const nextBtn = el.querySelector('[data-action="next-sibling"]') as HTMLButtonElement;
                if (prevBtn) prevBtn.disabled = newIndex === 0;
                if (nextBtn) nextBtn.disabled = newIndex === total - 1;
                break;
            }

            case 'retry_started':
                this.clearErrors();
                this.enterStreamingMode();
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

        // 重建 StreamController（因为 renderer 被清空了）
        this.stream = new StreamController(this.container, this.renderer);
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
