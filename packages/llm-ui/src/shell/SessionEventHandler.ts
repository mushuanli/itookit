// @file: llm-ui/shell/SessionEventHandler.ts

import type { SessionEvent, RegistryEvent, SessionManager } from '@itookit/llm-engine';
import { Toast, t } from '@itookit/common';
import type { IHistoryPresenter } from '../domain/ports/IHistoryPresenter';
import type { IStatusPresenter } from '../domain/ports/IStatusPresenter';
import type { IBranchPresenter } from '../domain/ports/IBranchPresenter';
import type { IChatInputPresenter } from '../domain/ports/IChatInputPresenter';
import type { IEditorEventBus } from '../domain/events';
import type { IBranchStore } from '../domain/ports/IBranchStore';

// ----------------------------------------------------------------
// 副作用声明表
// ----------------------------------------------------------------

type SideEffect =
    | 'renderFull' | 'refreshBranch' | 'refreshNav'
    | 'flashIndicator' | 'scrollToBottom' | 'clearErrors'
    | 'updateStatus' | 'notifyChange' | 'resetCollapse';

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
    branch_switched: ['resetCollapse', 'renderFull', 'scrollToBottom', 'refreshBranch', 'flashIndicator'],
    branch_deleted: ['refreshBranch', 'refreshNav'],
    branch_renamed: ['refreshBranch'],

    // 内容变更
    messages_deleted: ['refreshNav', 'notifyChange'],
    message_edited: ['refreshNav'],
    session_cleared: ['refreshNav', 'refreshBranch'],

    // 重新生成
    regenerate_started: ['clearErrors', 'flashIndicator'],
    regenerate_completed: ['refreshBranch', 'refreshNav'],

    // ── LLM 2.0 canonical / projection event names (S7) ──
    'message:appended': ['clearErrors', 'updateStatus', 'notifyChange', 'scrollToBottom'],
    'messages:cleared': ['refreshNav', 'refreshBranch'],
    'messages:deleted': ['refreshNav', 'notifyChange'],
    'message:edited': ['refreshNav'],
    'sibling:switched': ['renderFull', 'refreshBranch'],
    'log:appended': ['renderFull', 'scrollToBottom', 'refreshBranch'],
    'log:ref_moved': ['resetCollapse', 'renderFull', 'refreshBranch', 'flashIndicator'],
    'log:ref_renamed': ['refreshBranch'],
};

// ----------------------------------------------------------------
// 依赖接口
// ----------------------------------------------------------------

export interface SessionEventHandlerDeps {
    sessionManager: SessionManager;
    historyView: IHistoryPresenter;
    bus: IEditorEventBus;
    branchIndicator: IBranchPresenter;
    statusIndicator: IStatusPresenter;
    /** ChatInput presenter — 用于更新 token 用量显示 */
    chatInput: IChatInputPresenter;
    branchStore: IBranchStore;
    getCurrentSessionId: () => string | null;
    onContentChanged: () => void;
    onNavRefresh: () => void;
    /**
     * 导航到指定会话（可选）。
     *
     * 当后台会话发出 session_tty_active 事件时，通知条提示用户点击切换。
     * 由 Shell 注入，不提供时仅展示无操作的 Toast。
     */
    onNavigateToSession?: (sessionId: string) => void;
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
            resetCollapse:  () => this.deps.historyView.resetCollapseStates(),
        };
    }

    // ================================================================
    // 会话事件入口
    // ================================================================

    handleSessionEvent(event: SessionEvent): void {
        // 1. 始终转发给 HistoryView 处理 DOM 级更新（流式内容、节点追加等）
        this.deps.historyView.processEvent(event);

        // 2. 状态指示器（需要 payload，单独处理）
        this.updateStatusFromEvent(event);

        // 3. 分支事件携带 payload 的特定处理
        this.handleBranchEvent(event);

        // 4. 查表执行副作用
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

    /**
     * 分支事件处理 — 需要事件 payload 的操作集中于此
     */
    private handleBranchEvent(event: SessionEvent): void {
        const e = event as { type: string; payload?: any; [key: string]: any };
        switch (e.type) {
            case 'branch_deleted':
                this.deps.historyView.removeMessages(e.payload.deletedIds, true);
                break;

            case 'branch_renamed': {
                const el = this.deps.historyView.getElement(e.payload.nodeId);
                if (el) {
                    const nameEl = el.querySelector('.llm-branch-name');
                    if (nameEl) nameEl.textContent = e.payload.newName;
                }
                break;
            }

            // LLM 2.0 equivalents (S7)
            case 'messages:deleted':
                this.deps.historyView.removeMessages(e.payload.deletedIds, true);
                break;

            case 'log:ref_renamed': {
                const el2 = this.deps.historyView.getElement(e.payload.ref);
                if (el2) {
                    const nameEl2 = el2.querySelector('.llm-branch-name');
                    if (nameEl2) nameEl2.textContent = e.payload.newName;
                }
                break;
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
            case 'session_tty_active':
                // Only notify when the TTY activity is in a background session.
                if (event.payload.sessionId !== this.deps.getCurrentSessionId()) {
                    const navigate = this.deps.onNavigateToSession;
                    const ttyMsg = t('session.ttyActive', { command: event.payload.command });
                    if (navigate) {
                        Toast.action(ttyMsg, t('session.ttyActive.switchView'), () => navigate(event.payload.sessionId));
                    } else {
                        Toast.info(ttyMsg);
                    }
                }
                break;
            case 'session_hitl_active':
                // Background session is waiting for human input — notify the user.
                if (event.payload.sessionId !== this.deps.getCurrentSessionId()) {
                    const navigate = this.deps.onNavigateToSession;
                    const question = event.payload.question.length > 50
                        ? `${event.payload.question.slice(0, 50)}\u2026`
                        : event.payload.question;
                    const hitlMsg = t('session.hitlActive', { question });
                    if (navigate) {
                        Toast.action(hitlMsg, t('session.hitlActive.switch'), () => navigate(event.payload.sessionId));
                    } else {
                        Toast.info(hitlMsg);
                    }
                }
                break;
        }
    }

    private updateStatusFromEvent(event: SessionEvent): void {
        if (event.type === 'finished') {
            this.deps.statusIndicator.update('completed');

            // Support both old OrchestratorEvent { payload: { tokenUsage } }
            // and new canonical AgentEventFinished { usage: TokenUsage }
            // (both arrive as { type, payload } during transition via EventBus)
            const p = (event as any).payload;
            const tu = p?.tokenUsage ?? p?.usage ? {
                inputTokens: p?.tokenUsage?.inputTokens ?? p?.usage?.inputTokens ?? 0,
                outputTokens: p?.tokenUsage?.outputTokens ?? p?.usage?.outputTokens ?? 0,
                cacheReadTokens: p?.tokenUsage?.cacheReadTokens ?? p?.usage?.cacheReadTokens,
                costUsd: p?.tokenUsage?.costUsd ?? p?.usage?.costUsd ?? 0,
                contextUsageRatio: p?.tokenUsage?.contextUsageRatio ?? p?.usage?.contextUsageRatio ?? 0,
                turns: p?.tokenUsage?.turns ?? 0,
                durationMs: p?.tokenUsage?.durationMs ?? 0,
                isEstimated: p?.tokenUsage?.isEstimated ?? true,
            } : null;

            if (tu) {
                this.deps.chatInput.updateTokenStats(tu);
            }
        } else if (event.type === 'error') {
            this.deps.statusIndicator.update('failed');
        }
    }
}
