// @file: llm-ui/helpers/EventBinder.ts

export interface EventBinderCallbacks {
    onToggleSidebar: () => void;
    onTitleChange: (title: string) => void;
    onOpenAssetManager: () => void;
    onToggleNavigator: () => void;
    onPrevAgent: () => void;
    onNextAgent: () => void;
    onFoldOne: () => void;
    onCopyAgent: () => void;
    onCollapseAll: () => void;
    onCopy: () => void;
    onPrint: () => void;
}

export interface GlobalShortcutCallbacks {
    onToggleNavigator: () => void;
    onNavigatePrev: () => void;
    onNavigateNext: () => void;
    onShowBranchTree?: () => void;
    onCreateBranch?: () => void;
}

export class EventBinder {
    private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

    constructor(
        private container: HTMLElement,
        private callbacks: EventBinderCallbacks
    ) { }

    bindTitleBarEvents(): void {
        this.container.querySelector('#llm-btn-sidebar')?.addEventListener('click', () => {
            this.callbacks.onToggleSidebar();
        });

        const titleInput = this.container.querySelector('#llm-title-input') as HTMLInputElement;
        if (titleInput) {
            titleInput.addEventListener('blur', () => {
                this.callbacks.onTitleChange(titleInput.value);
            });
            titleInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') titleInput.blur();
            });
        }

        this.container.querySelector('#llm-btn-assets')?.addEventListener('click', () => {
            this.callbacks.onOpenAssetManager();
        });
    }

    bindNavigationEvents(): void {
        const bindings: Record<string, () => void> = {
            '#llm-btn-navigator': this.callbacks.onToggleNavigator,
            '#llm-btn-prev-agent': this.callbacks.onPrevAgent,
            '#llm-btn-next-agent': this.callbacks.onNextAgent,
            '#llm-btn-fold-one': this.callbacks.onFoldOne,
            '#llm-btn-copy-agent': this.callbacks.onCopyAgent,
            '#llm-btn-collapse': this.callbacks.onCollapseAll,
            '#llm-btn-copy': this.callbacks.onCopy,
            '#llm-btn-print': this.callbacks.onPrint,
        };

        for (const [selector, handler] of Object.entries(bindings)) {
            this.container.querySelector(selector)?.addEventListener('click', handler);
        }
    }

    bindGlobalShortcuts(shortcuts: GlobalShortcutCallbacks): void {
        this.keydownHandler = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

            const isMod = e.metaKey || e.ctrlKey;
            if (!isMod) return;

            // Cmd/Ctrl + Shift + B: 创建分支（先检查 Shift 组合）
            if (e.shiftKey && e.key === 'B' && shortcuts.onCreateBranch) {
                e.preventDefault();
                shortcuts.onCreateBranch();
                return;
            }

            const keyMap: Record<string, (() => void) | undefined> = {
                'k': shortcuts.onToggleNavigator,
                'ArrowUp': shortcuts.onNavigatePrev,
                'ArrowDown': shortcuts.onNavigateNext,
                'b': shortcuts.onShowBranchTree,
            };

            const handler = keyMap[e.key];
            if (handler) {
                e.preventDefault();
                handler();
            }
        };

        document.addEventListener('keydown', this.keydownHandler);
    }

    cleanup(): void {
        if (this.keydownHandler) {
            document.removeEventListener('keydown', this.keydownHandler);
            this.keydownHandler = null;
        }
    }
}
