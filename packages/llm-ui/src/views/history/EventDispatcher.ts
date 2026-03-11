// @file: llm-ui/views/history/EventDispatcher.ts

import { EventCleanup } from '../../base/infrastructure/EventCleanup';
import { TimerManager } from '../../base/infrastructure/TimerManager';
import { showConfirmDialog } from '@itookit/common';
import type { SessionRenderer } from './SessionRenderer';
import type { StreamController } from './StreamController';
import type { CollapseController } from './CollapseController';
import type { EditController } from './EditController';
import type { EditorEventBus } from '../../base/core/EditorEventBus';
import type { NodeActionCallback, NodeAction } from '../../base/core/types';

/**
 * 事件委托分发器
 *
 * 职责：
 * 1. 在 container 上注册单一 click 事件委托
 * 2. 根据 data-action 路由到对应的 Controller
 *
 * 使用 Strategy 模式：每个 action 是一个处理函数，
 * 注册在 actionMap 中，替代 15-case switch。
 */
export class EventDispatcher {
    private events = new EventCleanup();
    private timers = new TimerManager();
    private actionMap = new Map<string, ActionHandler>();

    constructor(
        private container: HTMLElement,
        private renderer: SessionRenderer,
        private stream: StreamController,
        private collapse: CollapseController,
        private edit: EditController,
        private bus: EditorEventBus | undefined,
        private onNodeAction: NodeActionCallback | undefined,
    ) {
        this.registerActions();
        this.bindDelegation();
    }
    private fireNodeAction(action: NodeAction, nodeId: string): void {
        this.onNodeAction?.(action, nodeId);
    }

    // ================================================================
    // 动作注册（Strategy Map）
    // ================================================================

    private registerActions(): void {
        const m = this.actionMap;

        m.set('collapse', (ctx) => {
            const collapsible = ctx.actionEl.closest(
                '.llm-ui-bubble--user, .llm-ui-node'
            ) as HTMLElement;
            if (!collapsible) return;

            const expanded = this.collapse.toggle(
                collapsible, ctx.actionEl, ctx.sessionId || ctx.nodeId,
                this.stream.isStreamingMode
            );

            // 展开时折叠内部代码块
            if (expanded && ctx.sessionId) {
                this.collapse.collapseCodeBlocksInSession(ctx.sessionId);
            }
        });

        m.set('copy', (ctx) => {
            const editor = this.renderer.getEditor(ctx.nodeId)
                || this.renderer.getEditor(ctx.sessionId);
            if (editor) {
                this.handleCopy(editor.content, ctx.actionEl);
            }
        });

        m.set('delete', (ctx) => {
            const role = ctx.sessionEl?.classList.contains('llm-ui-session--user')
                ? 'user' : 'assistant';
            this.handleDelete(ctx.sessionId, role);
        });


        m.set('retry', (ctx) => this.fireNodeAction('retry', ctx.sessionId));
        m.set('resend', (ctx) => this.fireNodeAction('resend', ctx.sessionId));
        m.set('prev-sibling', (ctx) => this.fireNodeAction('prev-sibling', ctx.sessionId));
        m.set('next-sibling', (ctx) => this.fireNodeAction('next-sibling', ctx.sessionId));

        m.set('create-branch', (ctx) => {
            this.bus?.emit('branch:create', {
                sourceNodeId: ctx.sessionId || ctx.nodeId,
            });
        });

        // 编辑相关
        m.set('edit', (ctx) => this.handleEditAction(ctx));
        m.set('confirm-edit', (ctx) => this.handleConfirmEdit(ctx, true));
        m.set('save-only', (ctx) => this.handleConfirmEdit(ctx, false));
        m.set('cancel-edit', (ctx) => this.handleCancelEdit(ctx));

        // 错误操作
        m.set('open-settings', () => {
            this.container.dispatchEvent(
                new CustomEvent('open-connection-settings', { bubbles: true })
            );
        });

        m.set('retry-last', (ctx) => {
            ctx.actionEl.closest('.llm-ui-session--system')?.remove();
            const lastId = this.findLastRetryableId();
            if (lastId) this.fireNodeAction('retry', lastId);
        });
    }

    // ================================================================
    // 事件委托
    // ================================================================

    private bindDelegation(): void {
        this.events.add(this.container, 'click', ((e: MouseEvent) => {
            const target = e.target as HTMLElement;
            const actionEl = target.closest('[data-action]') as HTMLElement;
            if (!actionEl) return;

            const action = actionEl.dataset.action;
            if (!action) return;

            e.stopPropagation();

            const sessionEl = actionEl.closest('[data-session-id]') as HTMLElement;
            const nodeEl = actionEl.closest('.llm-ui-node') as HTMLElement;

            const ctx: ActionContext = {
                actionEl,
                sessionEl,
                sessionId: sessionEl?.dataset.sessionId || '',
                nodeId: nodeEl?.dataset.id || sessionEl?.dataset.sessionId || '',
            };

            const handler = this.actionMap.get(action);
            if (handler) {
                handler(ctx);
            } else {
                console.warn(`[EventDispatcher] Unknown action: ${action}`);
            }
        }) as EventListener);
    }

    // ================================================================
    // 编辑动作（需要多步协调）
    // ================================================================

    private handleEditAction(ctx: ActionContext): void {
        // User bubble 编辑
        const editor = this.renderer.getEditor(ctx.sessionId);
        if (editor && ctx.sessionEl) {
            const actionsEl = ctx.sessionEl.querySelector('.llm-ui-edit-actions') as HTMLElement;
            if (actionsEl) {
                this.edit.toggleUserEdit(ctx.sessionId, editor, actionsEl, ctx.sessionEl);
                return;
            }
        }

        // Node 编辑
        const nodeEditor = this.renderer.getEditor(ctx.nodeId);
        if (nodeEditor) {
            this.edit.toggleNodeEdit(ctx.nodeId, ctx.sessionId, nodeEditor, ctx.actionEl);
        }
    }

    private handleConfirmEdit(ctx: ActionContext, regenerate: boolean): void {
        const editor = this.renderer.getEditor(ctx.sessionId);
        if (editor && ctx.sessionEl) {
            const actionsEl = ctx.sessionEl.querySelector('.llm-ui-edit-actions') as HTMLElement;
            if (actionsEl) {
                this.edit.confirmEdit(ctx.sessionId, editor, actionsEl, ctx.sessionEl, regenerate);
            }
        }
    }

    private handleCancelEdit(ctx: ActionContext): void {
        const editor = this.renderer.getEditor(ctx.sessionId);
        if (editor && ctx.sessionEl) {
            const actionsEl = ctx.sessionEl.querySelector('.llm-ui-edit-actions') as HTMLElement;
            if (actionsEl) {
                this.edit.cancelEdit(ctx.sessionId, editor, actionsEl, ctx.sessionEl);
            }
        }
    }

    // ================================================================
    // 通用动作
    // ================================================================

    private async handleCopy(content: string, btn: HTMLElement): Promise<void> {
        try {
            await navigator.clipboard.writeText(content);
            const orig = btn.innerHTML;
            btn.innerHTML = '✓';
            this.timers.setTimeout(() => { btn.innerHTML = orig; }, 1500);
        } catch (e) {
            console.error('Copy failed', e);
        }
    }

    private async handleDelete(nodeId: string, type: 'user' | 'assistant'): Promise<void> {
        let message = 'Delete this message?';
        if (type === 'user') {
            const count = this.countAssociatedResponses(nodeId);
            if (count > 0) message = `Delete this message and ${count} response(s)?`;
        }
        if (await showConfirmDialog(message)) {
            this.fireNodeAction('delete', nodeId);
        }
    }

    private countAssociatedResponses(userNodeId: string): number {
        const sessions = this.container.querySelectorAll('.llm-ui-session');
        let count = 0;
        let found = false;

        sessions.forEach(session => {
            const id = (session as HTMLElement).dataset.sessionId;
            if (id === userNodeId) { found = true; return; }
            if (found) {
                if (session.classList.contains('llm-ui-session--assistant')) {
                    count++;
                } else {
                    found = false;
                }
            }
        });
        return count;
    }

    private findLastRetryableId(): string | null {
        const all = Array.from(this.container.querySelectorAll('[data-session-id]'));
        if (all.length > 0) {
            return (all[all.length - 1] as HTMLElement).dataset.sessionId || null;
        }
        return null;
    }

    // ================================================================
    // 清理
    // ================================================================

    destroy(): void {
        this.events.cleanup();
        this.timers.destroy();
        this.actionMap.clear();
    }
}

// ================================================================
// 类型定义
// ================================================================

interface ActionContext {
    actionEl: HTMLElement;
    sessionEl: HTMLElement | null;
    sessionId: string;
    nodeId: string;
}

type ActionHandler = (ctx: ActionContext) => void;
