// @file: llm-ui/helpers/SessionEventHandler.ts

import { OrchestratorEvent, RegistryEvent, SessionManager } from '@itookit/llm-engine';
import { Toast } from '@itookit/common';
import { HistoryView } from '../views/HistoryView';
import { EditorEventBus } from '../base/core/EditorEventBus';
import { BranchIndicatorView } from '../views/BranchIndicatorView';
import { StatusIndicatorView } from '../views/StatusIndicatorView';
import { BranchStore } from './BranchStore';

export interface SessionEventHandlerDeps {
    sessionManager: SessionManager;
    historyView: HistoryView;
    bus: EditorEventBus;
    branchIndicator: BranchIndicatorView;
    statusIndicator: StatusIndicatorView;
    branchStore: BranchStore;
    getCurrentSessionId: () => string | null;
    onContentChanged: () => void;
    onFloatingNavRefresh: (() => Promise<void>) | null;
}

/**
 * 会话事件处理器
 * 
 * 职责：将引擎事件路由到对应的 View/Controller
 */
export class SessionEventHandler {
    private static readonly BRANCH_EVENTS = new Set([
        'branch_created', 'branch_switched', 'branch_deleted', 'branch_renamed',
        'regenerate_started', 'regenerate_completed',
    ]);

    private static readonly NEEDS_FULL_RENDER = new Set([
        'branch_switched', 'branch_created',
    ]);

    constructor(private deps: SessionEventHandlerDeps) { }

    handleSessionEvent(event: OrchestratorEvent): void {
        // ✅ 修复：只解构实际使用的变量
        const { historyView } = this.deps;

        // 1. 转发给 HistoryView 处理 DOM 更新
        historyView.processEvent(event);

        // 2. 状态更新
        this.updateStatus(event);

        // 3. 分支事件统一处理
        if (SessionEventHandler.BRANCH_EVENTS.has(event.type)) {
            this.handleBranchEvent(event);
        }
    }

    private updateStatus(event: OrchestratorEvent): void {
        if (event.type === 'finished' || event.type === 'session_start') {
            this.deps.onContentChanged();
        }

        if (event.type === 'session_start') {
            this.deps.historyView.clearErrors();
        }

        if (event.type === 'finished') {
            this.deps.statusIndicator.update('completed');
            this.deps.historyView.clearErrors();
        } else if (event.type === 'error') {
            this.deps.statusIndicator.update('failed');
        }
    }

    private handleBranchEvent(event: OrchestratorEvent): void {
        const { historyView, sessionManager, branchIndicator, branchStore } = this.deps;

        if (event.type === 'regenerate_started') {
            historyView.clearErrors();
            historyView.enterStreamingMode();
            branchIndicator.flash();
            return;
        }

        // 需要完整重渲染的事件
        if (SessionEventHandler.NEEDS_FULL_RENDER.has(event.type)) {
            historyView.renderFull(sessionManager.getSessions());
            historyView.scrollToBottom(true);
            branchIndicator.flash();
        }

        // 所有 branch 变化都刷新 store
        branchStore.refresh().then(() => {
            // ✅ 修复：安全调用可能为 null 的回调
            this.deps.onFloatingNavRefresh?.();
        });
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
