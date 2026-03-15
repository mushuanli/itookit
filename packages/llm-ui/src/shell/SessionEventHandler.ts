// @file: llm-ui/shell/SessionEventHandler.ts

import type { OrchestratorEvent, RegistryEvent, SessionManager } from '@itookit/llm-engine';
import { Toast } from '@itookit/common';
import type { IHistoryPresenter } from '../domain/ports/IHistoryPresenter';
import type { IStatusPresenter } from '../domain/ports/IStatusPresenter';
import type { IBranchPresenter } from '../domain/ports/IBranchPresenter';
import type { IEditorEventBus } from '../domain/events';
import type { BranchStore } from '../services/BranchStore';

// ----------------------------------------------------------------
// 副作用声明表
// ----------------------------------------------------------------

type SideEffect =
    | 'renderFull' | 'refreshBranch' | 'refreshNav'
    | 'flashIndicator' | 'scrollToBottom' | 'clearErrors'
    | 'updateStatus' | 'notifyChange';

/**
 * 集中声明式：事件 → 副作用映射
 *
 * 新增事件时只需在此表添加一行，不需要修改任何 if/switch 逻辑。
 * 符合 OCP：对扩展开放，对修改关闭。
 */
const EVENT_SIDE_EFFECTS: Partial<Record<string, SideEffect[]>> = {
    // 会话生命周期
    session_start: ['clearErrors', 'updateStatus', 'notifyChange'],
    finished: ['clearErrors', 'updateStatus', 'notifyChange', 'refreshNav'],
    error: ['updateStatus'],

    // 分支结构变更
    branch_created: ['renderFull', 'scrollToBottom', 'refreshBranch', 'flashIndicator'],
    branch_switched: ['renderFull', 'scrollToBottom', 'refreshBranch', 'flashIndicator'],
    branch_deleted: ['refreshBranch', 'refreshNav'],
    branch_renamed: ['refreshBranch'],

    // 内容变更
    messages_deleted: ['refreshNav', 'notifyChange'],
    message_edited: ['refreshNav'],
    session_cleared: ['refreshNav', 'refreshBranch'],

    // 重新生成
    regenerate_started: ['clearErrors', 'flashIndicator'],
    regenerate_completed: ['refreshBranch', 'refreshNav'],
};

// ----------------------------------------------------------------
// 依赖接口
// ----------------------------------------------------------------

export interface SessionEventHandlerDeps {
    sessionManager: SessionManager;
    historyView: IHistoryPresenter;       // ✅ 接口
    bus: IEditorEventBus;                 // ✅ 接口
    branchIndicator: IBranchPresenter;    // ✅ 接口
    statusIndicator: IStatusPresenter;    // ✅ 接口
    branchStore: BranchStore;
    getCurrentSessionId: () => string | null;
    onContentChanged: () => void;
    onNavRefresh: () => void;
}

// ----------------------------------------------------------------
// 实现
// ----------------------------------------------------------------

export class SessionEventHandler {
    /** 副作用执行器表：每种副作用对应一个执行函数 */
    private readonly executors: Record<SideEffect, () => void>;

    constructor(private deps: SessionEventHandlerDeps) {
        // 一次性绑定，避免每次事件都创建闭包
        this.executors = {
            renderFull:     () => this.deps.historyView.renderFull(
                this.deps.sessionManager.getSessions()
            ),
            refreshBranch:  () => this.deps.branchStore.refresh(),
            refreshNav:     () => this.deps.onNavRefresh(),
            flashIndicator: () => this.deps.branchIndicator.flash(),
            scrollToBottom: () => this.deps.historyView.scrollToBottom(true),
            clearErrors:    () => this.deps.historyView.clearErrors(),
            updateStatus:   () => {},  // 由 updateStatusFromEvent 处理
            notifyChange:   () => this.deps.onContentChanged(),
        };
    }

    // ================================================================
    // 会话事件入口
    // ================================================================

    handleSessionEvent(event: OrchestratorEvent): void {
        // 1. 始终转发给 HistoryView 处理 DOM 级更新
        this.deps.historyView.processEvent(event);

        // 2. 状态指示器（需要 payload，单独处理）
        this.updateStatusFromEvent(event);

        // 3. 查表执行副作用
        const effects = EVENT_SIDE_EFFECTS[event.type];
        if (effects) {
            const seen = new Set<SideEffect>();
            for (const effect of effects) {
                if (!seen.has(effect)) {
                    seen.add(effect);
                    this.executors[effect]();
                }
            }
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

    private updateStatusFromEvent(event: OrchestratorEvent): void {
        if (event.type === 'finished') this.deps.statusIndicator.update('completed');
        else if (event.type === 'error') this.deps.statusIndicator.update('failed');
    }
}
