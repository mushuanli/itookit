// @file: llm-ui/helpers/EventBinder.ts

import { EditorHostContext } from '@itookit/common';

export class EventBinder {
    private globalShortcutHandler: ((e: KeyboardEvent) => void) | null = null;

    constructor(
        private container: HTMLElement,
        private hostContext: EditorHostContext | undefined,
        private callbacks: {
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
        titleInput?.addEventListener('change', () => {
            this.callbacks.onTitleChange(titleInput.value);
        });

        // 附件管理
        this.container.querySelector('#llm-btn-assets')?.addEventListener('click', () => {
            this.callbacks.onOpenAssetManager();
        });

        // 导航按钮
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
     * 绑定导航相关事件
     */
    bindNavigationEvents(): void {
        // 打开连接设置
        this.container.addEventListener('open-connection-settings', () => {
            console.log('[EventBinder] Requesting to open connection settings...');
            if (this.hostContext?.navigate) {
                this.hostContext.navigate({
                    target: 'settings',
                    resourceId: 'connections'
                });
            } else {
                console.warn('[EventBinder] Host does not support navigation');
            }
        });

        // 打开 Agent 配置
        this.container.addEventListener('open-agent-config', (e: any) => {
            const agentId = e.detail?.agentId;
            if (agentId && this.hostContext?.navigate) {
                this.hostContext.navigate({
                    target: 'agents',
                    resourceId: agentId
                });
            }
        });
    }

    /**
     * 绑定全局快捷键
     */
    bindGlobalShortcuts(callbacks: {
        onToggleNavigator: () => void;
        onNavigatePrev: () => void;
        onNavigateNext: () => void;
    onShowBranchTree: () => void;  // ✅ 新增
    onCreateBranch: () => void;    // ✅ 新增
    }): void {
        this.globalShortcutHandler = (e: KeyboardEvent) => {
            // Ctrl/Cmd + G: 打开导航器
            if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
                e.preventDefault();
                callbacks.onToggleNavigator();
            }
        // ✅ Ctrl/Cmd + B: 打开分支树
        if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
            e.preventDefault();
            callbacks.onShowBranchTree();
        }

        // ✅ Ctrl/Cmd + Shift + B: 创建分支
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'B') {
            e.preventDefault();
            callbacks.onCreateBranch();
        }
            // Ctrl/Cmd + Shift + Up/Down: 快速导航
            if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
                if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    callbacks.onNavigatePrev();
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    callbacks.onNavigateNext();
                }
            }
        };

        document.addEventListener('keydown', this.globalShortcutHandler);
    }

    /**
     * 清理事件监听
     */
    cleanup(): void {
        if (this.globalShortcutHandler) {
            document.removeEventListener('keydown', this.globalShortcutHandler);
            this.globalShortcutHandler = null;
        }
    }
}
