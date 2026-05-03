// @file: llm-ui/domain/ports/IHistoryPresenter.ts

import type { CollapseStateMap } from '../types';
import type { SessionGroup, OrchestratorEvent } from '@itookit/llm-engine';

/**
 * History 视图的能力接口
 * 
 * Shell 和 Command 只通过此接口与 HistoryView 交互。
 * 任何 UI 实现的替换（如 React 版本）只需实现此接口。
 */
export interface IHistoryPresenter {
    // === 渲染 ===
    renderFull(sessions: SessionGroup[]): void;
    renderWelcome(): void;
    renderError(error: Error): void;
    clearErrors(): void;

    // === 消息操作 ===
    removeMessages(ids: string[], animated: boolean): string[];

    // === 折叠 ===
    getCollapseStates(): CollapseStateMap;
    resetCollapseStates(): void;
    toggleSessionCollapse(sessionId: string, forceState?: boolean): void;
    setAllCollapsed(collapsed: boolean): void;
    toggleAllFold(): boolean;
    shouldShowCollapseIcon(): boolean;
    /**
     * 折叠当前视口中可见的 unfold chat
     * 替代原来的 foldFirstUnfolded
     */
    foldCurrentUnfolded(): void;

    // === 滚动 ===
    scrollToBottom(force: boolean): void;

    // === 流式 ===
    enterStreamingMode(): void;
    exitStreamingMode(): void;

    // === 查询 ===
    getSessionElement(sessionId: string): HTMLElement | null;
    /** session element 或普通节点的组合查找（用于 branch_renamed DOM 更新） */
    getElement(id: string): HTMLElement | null;
    getUnfoldedNavigationTarget(direction: 'prev' | 'next'): string | null | '__end__' | '__start__';

    // === 事件处理 ===
    processEvent(event: OrchestratorEvent): void;

    // === 生命周期 ===
    destroy(): void;
}
