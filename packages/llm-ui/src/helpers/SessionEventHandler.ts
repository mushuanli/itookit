// @file: llm-ui/helpers/SessionEventHandler.ts

import { OrchestratorEvent, RegistryEvent, SessionManager } from '@itookit/llm-engine';
import { Toast } from '@itookit/common';
import { HistoryView } from '../views/HistoryView';
import { EditorEventBus } from '../base/core/EditorEventBus';
import { BranchIndicatorView } from '../views/BranchIndicatorView';
import { StatusIndicatorView } from '../views/StatusIndicatorView';

export interface SessionEventHandlerDeps {
    sessionManager: SessionManager;
    historyView: HistoryView;
    bus: EditorEventBus;
    branchIndicator: BranchIndicatorView;
    statusIndicator: StatusIndicatorView;
    getCurrentSessionId: () => string | null;
    onContentChanged: () => void;
    floatingNav: { refresh: () => Promise<void> } | null;
}

/**
 * 会话事件处理器
 * 
 * 职责：将引擎事件路由到对应的 View/Controller
 * 从 LLMWorkspaceEditor 中提取，消除 ~100 行代码
 */
export class SessionEventHandler {
    private static readonly BRANCH_EVENTS = new Set([
        'branch_created', 'branch_switched', 'branch_deleted', 'branch_renamed',
    ]);
    private static readonly BRANCH_RENDER_EVENTS = new Set([
        'branch_switched', 'branch_created',
    ]);

    constructor(private deps: SessionEventHandlerDeps) { }

    handleSessionEvent(event: OrchestratorEvent): void {
        const { historyView, sessionManager } = this.deps;

        // 1. 转发给 HistoryView 处理 DOM 更新
        historyView.processEvent(event);

        // 2. 状态更新
        if (event.type === 'finished' || event.type === 'session_start') {
            this.deps.onContentChanged();
        }

        if (event.type === 'session_start') {
            historyView.clearErrors();
        }

        if (event.type === 'finished') {
            this.deps.statusIndicator.update('completed');
            historyView.clearErrors();
        } else if (event.type === 'error') {
            this.deps.statusIndicator.update('failed');
        }

        // 3. 分支事件统一处理
        if (SessionEventHandler.BRANCH_EVENTS.has(event.type)) {
            if (SessionEventHandler.BRANCH_RENDER_EVENTS.has(event.type)) {
                historyView.renderFull(sessionManager.getSessions());
                historyView.scrollToBottom(true);
                this.deps.branchIndicator.flash();
            }
            this.deps.branchIndicator.refresh().then(() => {
                this.deps.floatingNav?.refresh();
            });
        }
    }

    handleGlobalEvent(event: RegistryEvent): void {
        switch (event.type) {
            case 'pool_status_changed':
                this.deps.statusIndicator.updateBackground(event.payload);
                break;
            case 'session_status_changed':
                if (event.payload.sessionId === this.deps.getCurrentSessionId()) {
                    this.deps.statusIndicator.update(event.payload.status);
                } else if (event.payload.status === 'completed') {
                    Toast.info('Background task completed');
                }
                break;
        }
    }
}
