// @file: llm-ui/helpers/EventBinder.ts

import { EditorHostContext } from '@itookit/common';

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
    // ✅ 新增：分支相关快捷键
    onShowBranchTree?: () => void;
    onCreateBranch?: () => void;
}

export class EventBinder {
    private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

    constructor(
        private container: HTMLElement,
        _hostContext: EditorHostContext | undefined,
        private callbacks: EventBinderCallbacks
    ) { }

    /**
     * 绑定标题栏事件
     */
    bindTitleBarEvents(): void {
        // Sidebar Toggle
        this.container.querySelector('#llm-btn-sidebar')?.addEventListener('click', () => {
            this.callbacks.onToggleSidebar();
        });

        // Title Edit
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

        // 资源管理器
        this.container.querySelector('#llm-btn-assets')?.addEventListener('click', () => {
            this.callbacks.onOpenAssetManager();
        });
    }

    /**
     * 绑定导航栏事件
     */
    bindNavigationEvents(): void {
        this.container.querySelector('#llm-btn-navigator')?.addEventListener('click', () => {
            this.callbacks.onToggleNavigator();
        });

        // Prev Agent Chat
        this.container.querySelector('#llm-btn-prev-agent')?.addEventListener('click', () => {
            this.callbacks.onPrevAgent();
        });

        // Next Agent Chat
        this.container.querySelector('#llm-btn-next-agent')?.addEventListener('click', () => {
            this.callbacks.onNextAgent();
        });

        // Fold First Unfolded
        this.container.querySelector('#llm-btn-fold-one')?.addEventListener('click', () => {
            this.callbacks.onFoldOne();
        });

        // Copy First Unfolded Agent Chat
        this.container.querySelector('#llm-btn-copy-agent')?.addEventListener('click', () => {
            this.callbacks.onCopyAgent();
        });

        // Collapse/Expand All
        this.container.querySelector('#llm-btn-collapse')?.addEventListener('click', () => {
            this.callbacks.onCollapseAll();
        });

        // Copy as Markdown
        this.container.querySelector('#llm-btn-copy')?.addEventListener('click', () => {
            this.callbacks.onCopy();
        });

        // Print
        this.container.querySelector('#llm-btn-print')?.addEventListener('click', () => {
            this.callbacks.onPrint();
        });
    }

    /**
     * 绑定全局快捷键
     */
    bindGlobalShortcuts(shortcuts: GlobalShortcutCallbacks): void {
        this.keydownHandler = (e: KeyboardEvent) => {
            // 忽略输入框中的快捷键
            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
                return;
            }

            const isMod = e.metaKey || e.ctrlKey;

            // Cmd/Ctrl + K: 打开导航器
            if (isMod && e.key === 'k') {
                e.preventDefault();
                shortcuts.onToggleNavigator();
                return;
            }

            // Cmd/Ctrl + ↑: 上一个用户消息
            if (isMod && e.key === 'ArrowUp') {
                e.preventDefault();
                shortcuts.onNavigatePrev();
                return;
            }

            // Cmd/Ctrl + ↓: 下一个用户消息
            if (isMod && e.key === 'ArrowDown') {
                e.preventDefault();
                shortcuts.onNavigateNext();
                return;
            }

            // ✅ Cmd/Ctrl + B: 显示分支树
            if (isMod && e.key === 'b' && shortcuts.onShowBranchTree) {
                e.preventDefault();
                shortcuts.onShowBranchTree();
                return;
            }

            // ✅ Cmd/Ctrl + Shift + B: 创建分支
            if (isMod && e.shiftKey && e.key === 'B' && shortcuts.onCreateBranch) {
                e.preventDefault();
                shortcuts.onCreateBranch();
                return;
            }
        };

        document.addEventListener('keydown', this.keydownHandler);
    }

    /**
     * 清理事件监听
     */
    cleanup(): void {
        if (this.keydownHandler) {
            document.removeEventListener('keydown', this.keydownHandler);
            this.keydownHandler = null;
        }
    }
}
