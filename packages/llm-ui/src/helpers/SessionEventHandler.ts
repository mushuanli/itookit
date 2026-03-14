// @file: llm-ui/helpers/SessionEventHandler.ts

import { OrchestratorEvent, RegistryEvent, SessionManager } from '@itookit/llm-engine';
import { Toast } from '@itookit/common';
import { HistoryView } from '../views/HistoryView';
import { EditorEventBus } from '../base/core/EditorEventBus';
import { BranchIndicatorView } from '../views/BranchIndicatorView';
import { StatusIndicatorView } from '../views/StatusIndicatorView';
import { BranchStore } from './BranchStore';

// ----------------------------------------------------------------
// 副作用类型与事件声明表
// ----------------------------------------------------------------

type SideEffect =
    | 'renderFull'
    | 'refreshBranch'
    | 'refreshNav'
    | 'flashIndicator'
    | 'scrollToBottom'
    | 'clearErrors'
    | 'updateStatus'
    | 'notifyChange';

/**
 * 集中声明式：事件 → 副作用映射
 *
 * 新增事件时只需在此表添加一行，不需要修改任何 if/switch 逻辑。
 * 符合 OCP：对扩展开放，对修改关闭。
 */
const EVENT_SIDE_EFFECTS: Partial<Record<string, SideEffect[]>> = {
    // 会话生命周期
    session_start:        ['clearErrors', 'updateStatus', 'notifyChange'],
    finished:             ['clearErrors', 'updateStatus', 'notifyChange', 'refreshNav'],
    error:                ['updateStatus'],

    // 分支结构变更
    branch_created:       ['renderFull', 'scrollToBottom', 'refreshBranch', 'flashIndicator'],
    branch_switched:      ['renderFull', 'scrollToBottom', 'refreshBranch', 'flashIndicator'],
    branch_deleted:       ['refreshBranch', 'refreshNav'],
    branch_renamed:       ['refreshBranch'],

    // 内容变更
    messages_deleted:     ['refreshNav', 'notifyChange'],
    message_edited:       ['refreshNav'],
    session_cleared:      ['refreshNav', 'refreshBranch'],

    // 重新生成
    regenerate_started:   ['clearErrors', 'flashIndicator'],
    regenerate_completed: ['refreshBranch', 'refreshNav'],
};

// ----------------------------------------------------------------
// 依赖接口
// ----------------------------------------------------------------

export interface SessionEventHandlerDeps {
    sessionManager: SessionManager;
    historyView: HistoryView;
    bus: EditorEventBus;
    branchIndicator: BranchIndicatorView;
    statusIndicator: StatusIndicatorView;
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
            renderFull:     () => this.renderFull(),
            refreshBranch:  () => this.refreshBranch(),
            refreshNav:     () => this.deps.onNavRefresh(),
            flashIndicator: () => this.deps.branchIndicator.flash(),
            scrollToBottom: () => this.deps.historyView.scrollToBottom(true),
            clearErrors:    () => this.deps.historyView.clearErrors(),
            updateStatus:   () => {}, // 由 updateStatusFromEvent 单独处理（需要 payload）
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
            this.executeSideEffects(effects);
        }
    }

    // ================================================================
    // 全局事件入口
    // ================================================================

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

    // ================================================================
    // 内部实现
    // ================================================================

    private executeSideEffects(effects: SideEffect[]): void {
        // 去重（同一事件声明中不会重复，但防御性编程）
        const seen = new Set<SideEffect>();

        for (const effect of effects) {
            if (seen.has(effect)) continue;
            seen.add(effect);
            this.executors[effect]();
        }
    }

    private updateStatusFromEvent(event: OrchestratorEvent): void {
        switch (event.type) {
            case 'finished':
                this.deps.statusIndicator.update('completed');
                break;
            case 'error':
                this.deps.statusIndicator.update('failed');
                break;
        }
    }

    private renderFull(): void {
        const { historyView, sessionManager } = this.deps;
        historyView.renderFull(sessionManager.getSessions());
    }

    /**
     * 刷新 BranchStore
     * 
     * refreshNav 会在 BranchStore.onChange 中自动触发，
     * 但如果事件同时声明了 refreshBranch + refreshNav，
     * refreshNav 会执行两次（一次来自声明，一次来自 onChange）。
     * 
     * 解决方案：refreshBranch 自带 refreshNav 语义，
     * 在声明表中不需要同时声明两者。
     * 
     * 但当前实现保持幂等：多次调用 onNavRefresh 只是多一次数据构建，
     * 没有副作用。性能敏感时可以加 debounce。
     */
    private refreshBranch(): void {
        this.deps.branchStore.refresh().then(() => {
            // BranchStore.onChange 会触发 BranchIndicatorView.render()
            // Nav 刷新由声明表中的 refreshNav 显式控制
        });
    }
}
