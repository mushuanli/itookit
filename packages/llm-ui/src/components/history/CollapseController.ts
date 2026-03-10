// @file: llm-ui/components/history/CollapseController.ts

import { CollapseStateMap } from '../../core/types';
import type { SessionRenderer } from './SessionRenderer';
import type { EditorEventBus } from '../../core/EditorEventBus';

/**
 * 折叠状态控制器
 *
 * 职责：
 * 1. 管理 session/node 折叠状态
 * 2. 计算初始折叠状态
 * 3. 操作 DOM 折叠/展开
 * 4. 触发代码块折叠
 * 5. 通知状态持久化
 *
 * 不负责：编辑模式、流式更新
 */
export class CollapseController {
    private states: CollapseStateMap = {};

    constructor(
        private container: HTMLElement,
        private renderer: SessionRenderer,
        private bus?: EditorEventBus,
        initialStates?: CollapseStateMap
    ) {
        if (initialStates) {
            this.states = { ...initialStates };
        }
    }

    // ================================================================
    // 状态访问
    // ================================================================

    getStates(): CollapseStateMap {
        return { ...this.states };
    }

    setState(id: string, collapsed: boolean): void {
        this.states[id] = collapsed;
    }

    resetStates(): void {
        this.states = {};
    }

    /**
     * 计算 session 的初始折叠状态
     */
    computeInitialState(
        sessionId: string,
        role: string,
        index: number,
        totalCount: number
    ): boolean {
        const hasStored = Object.keys(this.states).length > 0;

        if (hasStored && this.states[sessionId] !== undefined) {
            return this.states[sessionId];
        }

        const shouldCollapse = role === 'user' ? true : (index < totalCount - 1);
        this.states[sessionId] = shouldCollapse;
        return shouldCollapse;
    }

    // ================================================================
    // 单项折叠
    // ================================================================

    /**
     * 切换折叠（由事件委托触发）
     *
     * @returns true 如果从折叠变为展开（需要触发代码块折叠）
     */
    toggle(
        element: HTMLElement,
        btn: HTMLElement,
        sessionId: string,
        isStreaming: boolean
    ): boolean {
        const wasCollapsed = element.classList.contains('is-collapsed');
        element.classList.toggle('is-collapsed');
        const isCollapsed = element.classList.contains('is-collapsed');

        this.updateChevron(btn, isCollapsed);
        this.states[sessionId] = isCollapsed;

        if (!isStreaming) {
            this.notifyChange();
        }

        return wasCollapsed && !isCollapsed;
    }

    /**
     * 按 sessionId 切换折叠（供 Command/外部调用）
     */
    toggleSession(sessionId: string, forceState?: boolean): boolean {
        const sessionEl = this.container.querySelector(
            `[data-session-id="${sessionId}"]`
        ) as HTMLElement;
        if (!sessionEl) return false;

        const collapsible = sessionEl.querySelector(
            '.llm-ui-bubble--user, .llm-ui-node'
        ) as HTMLElement;
        if (!collapsible) return false;

        const current = collapsible.classList.contains('is-collapsed');
        const target = forceState !== undefined ? forceState : !current;
        if (target === current) return false;

        collapsible.classList.toggle('is-collapsed', target);
        const btn = collapsible.querySelector('[data-action="collapse"]') as HTMLElement;
        if (btn) this.updateChevron(btn, target);

        this.states[sessionId] = target;
        this.notifyChange();

        return current && !target; // 从折叠→展开
    }

    // ================================================================
    // 批量折叠
    // ================================================================

    setAllCollapsed(collapsed: boolean): void {
        const items = this.container.querySelectorAll('.llm-ui-bubble--user, .llm-ui-node');
        items.forEach((el) => {
            el.classList.toggle('is-collapsed', collapsed);
            const btn = el.querySelector('[data-action="collapse"]') as HTMLElement;
            if (btn) this.updateChevron(btn, collapsed);
        });

        this.container.querySelectorAll('[data-session-id]').forEach(el => {
            const id = (el as HTMLElement).dataset.sessionId;
            if (id) this.states[id] = collapsed;
        });

        this.notifyChange();
    }

    foldFirstUnfolded(): void {
        const items = this.container.querySelectorAll('.llm-ui-bubble--user, .llm-ui-node');
        for (const item of items) {
            if (!item.classList.contains('is-collapsed')) {
                const btn = item.querySelector('[data-action="collapse"]') as HTMLElement;
                if (btn) { btn.click(); return; }
            }
        }
    }

    // ================================================================
    // 代码块折叠
    // ================================================================

    async collapseCodeBlocksInSession(sessionId: string): Promise<void> {
        const ids = this.renderer.getEditorIdsForSession(sessionId);
        await Promise.all(ids.map(async (id) => {
            const ctrl = this.renderer.getEditor(id);
            if (ctrl) {
                try {
                    await ctrl.waitUntilReady();
                    await ctrl.collapseBlocks();
                } catch (e) {
                    console.warn(`[CollapseController] Code block collapse failed: ${id}`, e);
                }
            }
        }));
    }

    async batchCodeBlockAction(action: 'collapse' | 'expand'): Promise<void> {
        const promises: Promise<void>[] = [];
        this.renderer.editors.forEach((ctrl, id) => {
            promises.push((async () => {
                try {
                    await ctrl.waitUntilReady();
                    action === 'collapse' ? await ctrl.collapseBlocks() : await ctrl.expandBlocks();
                } catch (e) {
                    console.warn(`[CollapseController] ${action} failed: ${id}`, e);
                }
            })());
        });
        await Promise.all(promises);
    }

    // ================================================================
    // 内部
    // ================================================================

    private updateChevron(btn: HTMLElement, isCollapsed: boolean): void {
        const svg = btn.querySelector('svg');
        if (svg) {
            svg.innerHTML = isCollapsed
                ? '<polyline points="6 9 12 15 18 9"></polyline>'
                : '<polyline points="18 15 12 9 6 15"></polyline>';
        }
    }

    private notifyChange(): void {
        this.bus?.emit('state:collapseChanged', { states: { ...this.states } });
    }

    destroy(): void {
        this.states = {};
    }
}
