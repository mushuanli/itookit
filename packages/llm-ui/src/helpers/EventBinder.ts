// @file: llm-ui/helpers/EventBinder.ts

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
    onSwitchBranchPrev: () => void;
    onSwitchBranchNext: () => void;
}

export class EventBinder {
    private container: HTMLElement;
    private callbacks: EventBinderCallbacks;
    
    // ✅ 添加缺失的属性
    private globalKeyHandler: ((e: KeyboardEvent) => void) | null = null;

    constructor(container: HTMLElement, callbacks: EventBinderCallbacks) {
        this.container = container;
        this.callbacks = callbacks;
    }

    bindTitleBarEvents(): void {
        const titleInput = this.container.querySelector('#llm-title-input') as HTMLInputElement;
        if (titleInput) {
            titleInput.addEventListener('blur', () => {
                this.callbacks.onTitleChange(titleInput.value);
            });
            titleInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    titleInput.blur();
                }
            });
        }

        this.container.querySelector('#llm-btn-sidebar')?.addEventListener('click', () => {
            this.callbacks.onToggleSidebar();
        });

        this.container.querySelector('#llm-btn-assets')?.addEventListener('click', () => {
            this.callbacks.onOpenAssetManager();
        });

        this.container.querySelector('#llm-btn-collapse')?.addEventListener('click', () => {
            this.callbacks.onCollapseAll();
        });

        this.container.querySelector('#llm-btn-copy')?.addEventListener('click', () => {
            this.callbacks.onCopy();
        });

        this.container.querySelector('#llm-btn-print')?.addEventListener('click', () => {
            this.callbacks.onPrint();
        });

        this.container.querySelector('#llm-btn-navigator')?.addEventListener('click', () => {
            this.callbacks.onToggleNavigator();
        });
    }

    bindNavigationEvents(): void {
        this.container.querySelector('#llm-btn-prev-agent')?.addEventListener('click', () => {
            this.callbacks.onPrevAgent();
        });

        this.container.querySelector('#llm-btn-next-agent')?.addEventListener('click', () => {
            this.callbacks.onNextAgent();
        });

        this.container.querySelector('#llm-btn-fold-one')?.addEventListener('click', () => {
            this.callbacks.onFoldOne();
        });
    }

    bindGlobalShortcuts(callbacks: GlobalShortcutCallbacks): void {
        this.globalKeyHandler = (e: KeyboardEvent) => {
            const isCtrlOrMeta = e.ctrlKey || e.metaKey;

            // Ctrl+G: 打开 Navigator（统一入口）
            if (isCtrlOrMeta && e.key === 'g') {
                e.preventDefault();
                callbacks.onToggleNavigator();
                return;
            }

            // Ctrl+↑/↓: 导航
            if (isCtrlOrMeta && e.key === 'ArrowUp') {
                e.preventDefault();
                callbacks.onNavigatePrev();
                return;
            }
            if (isCtrlOrMeta && e.key === 'ArrowDown') {
                e.preventDefault();
                callbacks.onNavigateNext();
                return;
            }

            // ⌘⇧B: 创建分支
            if (isCtrlOrMeta && e.shiftKey && e.key === 'B') {
                e.preventDefault();
                callbacks.onCreateBranch();
                return;
            }

            // ⌘⇧[ / ⌘⇧]: 切换分支
            if (isCtrlOrMeta && e.shiftKey && e.key === '[') {
                e.preventDefault();
                callbacks.onSwitchBranchPrev();
                return;
            }
            if (isCtrlOrMeta && e.shiftKey && e.key === ']') {
                e.preventDefault();
                callbacks.onSwitchBranchNext();
                return;
            }
        };

        document.addEventListener('keydown', this.globalKeyHandler);
    }

    cleanup(): void {
        if (this.globalKeyHandler) {
            document.removeEventListener('keydown', this.globalKeyHandler);
            this.globalKeyHandler = null;
        }
    }
}
