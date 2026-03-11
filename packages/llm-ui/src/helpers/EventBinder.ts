// @file: llm-ui/helpers/EventBinder.ts

import { EventCleanup } from '../base/infrastructure/EventCleanup';

export interface EventBinderCallbacks {
    onToggleSidebar: () => void;
    onTitleChange: (title: string) => void;
    onOpenAssetManager: () => void;
    onToggleNavigator: () => void;
    onPrevAgent: () => void;
    onNextAgent: () => void;
    onFoldOne: () => void;
    onCollapseAll: () => void;
    onCopy: () => void;
    onPrint: () => void;
}

export interface GlobalShortcutCallbacks {
    onToggleNavigator: () => void;
    onNavigatePrev: () => void;
    onNavigateNext: () => void;
    onCreateBranch: () => void;
    onSwitchBranchPrev?: () => void;
    onSwitchBranchNext?: () => void;
}

export class EventBinder {
    // ✅ 改动：用 EventCleanup 替代手动管理 keydownHandler
    private events = new EventCleanup();

    constructor(
        private container: HTMLElement,
        private callbacks: EventBinderCallbacks
    ) { }

    bindTitleBarEvents(): void {
        const sidebarBtn = this.container.querySelector('#llm-btn-sidebar');
        if (sidebarBtn) {
            this.events.add(sidebarBtn, 'click', () => {
                this.callbacks.onToggleSidebar();
            });
        }

        const titleInput = this.container.querySelector('#llm-title-input') as HTMLInputElement;
        if (titleInput) {
            this.events.add(titleInput, 'blur', () => {
                this.callbacks.onTitleChange(titleInput.value);
            });
            this.events.add(titleInput, 'keydown', ((e: KeyboardEvent) => {
                if (e.key === 'Enter') titleInput.blur();
            }) as EventListener);
        }

        const assetsBtn = this.container.querySelector('#llm-btn-assets');
        if (assetsBtn) {
            this.events.add(assetsBtn, 'click', () => {
                this.callbacks.onOpenAssetManager();
            });
        }
    }

    bindNavigationEvents(): void {
        const bindings: Record<string, () => void> = {
            '#llm-btn-navigator': this.callbacks.onToggleNavigator,
            '#llm-btn-prev-agent': this.callbacks.onPrevAgent,
            '#llm-btn-next-agent': this.callbacks.onNextAgent,
            '#llm-btn-fold-one': this.callbacks.onFoldOne,
            '#llm-btn-collapse': this.callbacks.onCollapseAll,
            '#llm-btn-copy': this.callbacks.onCopy,
            '#llm-btn-print': this.callbacks.onPrint,
        };

        for (const [selector, handler] of Object.entries(bindings)) {
            const el = this.container.querySelector(selector);
            if (el) {
                // ✅ 改动：通过 EventCleanup 注册
                this.events.add(el, 'click', handler);
            }
        }
    }

    bindGlobalShortcuts(shortcuts: GlobalShortcutCallbacks): void {
        const keydownHandler = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

            const isMod = e.metaKey || e.ctrlKey;
            if (!isMod) return;

            // Cmd/Ctrl + Shift + B: 创建分支
            if (e.shiftKey && e.key === 'B') {
                e.preventDefault();
                shortcuts.onCreateBranch();
                return;
            }

            // ✅ 新增: Cmd/Ctrl + Shift + [ / ] : 切换分支
            if (e.shiftKey && e.key === '[' && shortcuts.onSwitchBranchPrev) {
                e.preventDefault();
                shortcuts.onSwitchBranchPrev();
                return;
            }
            if (e.shiftKey && e.key === ']' && shortcuts.onSwitchBranchNext) {
                e.preventDefault();
                shortcuts.onSwitchBranchNext();
                return;
            }

            const keyMap: Record<string, (() => void) | undefined> = {
                'k': shortcuts.onToggleNavigator,
                'ArrowUp': shortcuts.onNavigatePrev,
                'ArrowDown': shortcuts.onNavigateNext,
            };

            const handler = keyMap[e.key];
            if (handler) {
                e.preventDefault();
                handler();
            }
        };

        // ✅ 改动：通过 EventCleanup 注册 document 级事件
        this.events.add(document, 'keydown', keydownHandler as EventListener);
    }

    // ✅ 改动：统一清理替代手动移除
    cleanup(): void {
        this.events.cleanup();
    }
}
