// @file: llm-ui/domain/ports/IHistoryPresenter.ts

import type { SessionGroup, SessionEvent } from '@itookit/llm-engine';
import type { ICollapseManager } from './ICollapseManager';
import type { IStreamingController } from './IStreamingController';

/**
 * History 视图的能力接口
 *
 * Extends ICollapseManager + IStreamingController for backward compatibility.
 * New consumers should depend on the narrowest role interface they need:
 *   - ICollapseManager for fold/expand operations
 *   - IStreamingController for streaming lifecycle
 *
 * Shell 和 Command 只通过此接口与 HistoryView 交互。
 * 任何 UI 实现的替换（如 React 版本）只需实现此接口。
 */
export interface IHistoryPresenter extends ICollapseManager, IStreamingController {
    // === 渲染 ===
    renderFull(sessions: SessionGroup[]): void;
    renderWelcome(): void;
    renderError(error: Error): void;
    clearErrors(): void;

    // === 消息操作 ===
    removeMessages(ids: string[], animated: boolean): string[];

    // === 滚动 ===
    scrollToBottom(force: boolean): void;

    // === 查询 ===
    getSessionElement(sessionId: string): HTMLElement | null;
    getElement(id: string): HTMLElement | null;
    getUnfoldedNavigationTarget(direction: 'prev' | 'next'): string | null | '__end__' | '__start__';

    // === 事件处理 ===
    processEvent(event: SessionEvent): void;

    // === 生命周期 ===
    destroy(): void;
}
