// @file: llm-ui/components/input/plugins/SlashCommandPlugin.ts

import type { InputPlugin, InputPluginContext } from './InputPlugin';
import { PopupPanel, PopupItem } from './PopupPanel';

/**
 * Slash 命令定义
 */
export interface SlashCommandDef {
    /** 命令名（不含 /） */
    name: string;
    /** 显示标签 */
    label: string;
    /** 描述 */
    description: string;
    /** 图标 */
    icon?: string;
    /** 分组 */
    group?: string;
    /** 执行函数 */
    execute: (args: string, ctx: InputPluginContext) => void | Promise<void>;
    /** 是否需要参数 */
    hasArgs?: boolean;
    /** 参数占位符 */
    argsPlaceholder?: string;
    /** 执行后是否保留输入框内容（默认 false = 清空） */
    preserveInput?: boolean;
}

/**
 * Slash Command 回调接口
 * 
 * 将命令的实际执行委托给外部（Shell 层），
 * 插件本身不依赖 SessionManager 等业务对象。
 */
export interface SlashCommandCallbacks {
    // Common
    onRetry: () => void;
    onClear: () => void;
    onDeleteLast: () => void;
    onReedit: () => void;

    // Refine
    onShorter: () => void;
    onLonger: () => void;
    onSimplify: () => void;
    onSummarize: () => void;
    onContinue: () => void;

    // Context
    onHistory: (length: string) => void;
    onFresh: () => void;

    // View
    onFoldCurrent: () => void;
    onFoldAll: () => void;
    onUnfoldAll: () => void;
    onTop: () => void;
    onBottom: () => void;
    onNav: () => void;

    // Tools
    onExport: () => void;
    onCopyAll: () => void;
    onPrint: () => void;

    // Branch
    onCreateBranch: () => void;
    onSwitchBranch: (name: string) => void;
    onBranchPrev: () => void;
    onBranchNext: () => void;
    onListBranches: () => void;
    onRenameBranch: (args: string) => void;
    onDeleteBranch: (name: string) => void;

    // Settings
    onSwitchAgent: (agentId: string) => void;
    onModel: (modelId: string) => void;

    // Help
    onHelp: () => void;
}

/**
 * Slash Command 插件
 * 
 * 交互设计（参考 Notion/Discord）：
 * - 输入框开头输入 `/`：触发命令面板
 * - 实时模糊搜索
 * - Enter/Tab 执行选中命令
 * - Esc 关闭并保留输入
 * - 带参数命令：选中后填入命令+占位符
 * 
 * 设计要点：
 * - 命令注册是声明式的
 * - 执行逻辑通过回调委托给 Shell
 * - 不直接依赖 SessionManager（DIP）
 */
export class SlashCommandPlugin implements InputPlugin {
    readonly id = 'slash-commands';
    readonly priority = 40;

    private ctx: InputPluginContext | null = null;
    private panel: PopupPanel | null = null;
    private commands: SlashCommandDef[] = [];

    constructor(callbacks: SlashCommandCallbacks) {
        this.commands = this.buildDefaultCommands(callbacks);
    }

    activate(ctx: InputPluginContext): void {
        this.ctx = ctx;

        this.panel = new PopupPanel(ctx.textarea, {
            maxVisible: 12,
            showSearch: false,
            emptyText: 'No matching commands',
            footerHint: '↑↓ Navigate · Enter Execute · Esc Close',
            variant: 'slash',
            animated: true,
        });
    }

    // ================================================================
    // 注册自定义命令
    // ================================================================

    /**
     * 注册额外命令（供外部扩展）
     */
    registerCommand(command: SlashCommandDef): void {
        this.commands = this.commands.filter(c => c.name !== command.name);
        this.commands.push(command);
    }

    /**
     * 批量注册
     */
    registerCommands(commands: SlashCommandDef[]): void {
        commands.forEach(cmd => this.registerCommand(cmd));
    }

    // ================================================================
    // 键盘钩子
    // ================================================================

    onKeyDown(e: KeyboardEvent): boolean {
        if (this.panel?.isVisible) {
            if (this.panel.handleKeyDown(e)) {
                return true;
            }
            if (e.key === 'Escape') {
                this.closePanel();
                return true;
            }
            return false;
        }
        return false;
    }

    onInput(text: string, _cursorPos: number): void {
        if (text.startsWith('/')) {
            const query = text.slice(1).split(/\s/)[0];
            this.showCommands(query);
        } else if (this.panel?.isVisible) {
            this.closePanel();
        }
    }

    onBeforeSend(text: string): boolean | void {
        if (!text.startsWith('/')) return;

        const match = text.match(/^\/(\S+)\s*(.*)/);
        if (!match) return;

        const [, cmdName, args] = match;
        const command = this.commands.find(c => c.name === cmdName);

        if (command) {
            this.executeCommand(command, args.trim());
            return false;
        }
    }

    // ================================================================
    // 核心逻辑
    // ================================================================

    private showCommands(query: string): void {
        if (!this.panel) return;

        const items = this.commandsToPopupItems(this.commands);

        if (!this.panel.isVisible) {
            this.panel.show(items, {
                onSelect: (item) => this.handleSelect(item),
                onClose: () => { },
            });
        }

        this.panel.filter(query);
    }

    private handleSelect(item: PopupItem): void {
        if (!this.ctx) return;

        const command = this.commands.find(c => c.name === item.id);
        if (!command) return;

        if (command.hasArgs) {
            const placeholder = command.argsPlaceholder || '';
            this.ctx.setText(`/${command.name} ${placeholder}`);
            this.ctx.focus();
            this.ctx.setCursorPosition(command.name.length + 2);
        } else {
            this.executeCommand(command, '');
        }
    }

    /**
     * 执行命令
     * 
     * ✅ 关键修改：先清空输入，再执行命令。
     * 命令（如 /reedit）可能在执行过程中通过 restoreInput 写入新内容，
     * 如果在执行后清空会覆盖掉命令写入的内容。
     * 
     * 对于声明了 preserveInput 的命令，不做预清空。
     */
    private async executeCommand(command: SlashCommandDef, args: string): Promise<void> {
        if (!this.ctx) return;

        // 执行前清空（除非命令声明保留输入）
        if (!command.preserveInput) {
            this.ctx.setText('');
        }

        try {
            await command.execute(args, this.ctx);
        } catch (e) {
            console.error(`[SlashCommand] Failed to execute /${command.name}:`, e);
        }

        this.ctx.focus();
    }

    private closePanel(): void {
        this.panel?.hide();
    }

    // ================================================================
    // 默认命令注册
    // ================================================================

    private buildDefaultCommands(cb: SlashCommandCallbacks): SlashCommandDef[] {
        return [
            // ── Common ──────────────────────────────────────────
            {
                name: 'retry',
                label: '/retry',
                description: 'Regenerate last response',
                icon: '🔄',
                group: 'Common',
                execute: () => cb.onRetry(),
            },
            {
                name: 'continue',
                label: '/continue',
                description: 'Continue generating from where it stopped',
                icon: '▶️',
                group: 'Common',
                execute: () => cb.onContinue(),
            },
            {
                name: 'reedit',
                label: '/reedit',
                description: 'Undo last send — restore prompt to input and delete the message',
                icon: '↩️',
                group: 'Common',
                preserveInput: true,
                execute: () => cb.onReedit(),
            },
            {
                name: 'delete',
                label: '/delete',
                description: 'Delete last user message and its responses',
                icon: '✂️',
                group: 'Common',
                execute: () => cb.onDeleteLast(),
            },
            {
                name: 'clear',
                label: '/clear',
                description: 'Clear all messages',
                icon: '🗑️',
                group: 'Common',
                execute: () => cb.onClear(),
            },

            // ── Refine ──────────────────────────────────────────
            {
                name: 'shorter',
                label: '/shorter',
                description: 'Ask to make the last response more concise',
                icon: '📏',
                group: 'Refine',
                execute: () => cb.onShorter(),
            },
            {
                name: 'longer',
                label: '/longer',
                description: 'Ask to elaborate on the last response',
                icon: '📐',
                group: 'Refine',
                execute: () => cb.onLonger(),
            },
            {
                name: 'simplify',
                label: '/simplify',
                description: 'Explain the last response in simpler terms',
                icon: '💡',
                group: 'Refine',
                execute: () => cb.onSimplify(),
            },
            {
                name: 'summarize',
                label: '/summarize',
                description: 'Summarize the entire conversation so far',
                icon: '📝',
                group: 'Refine',
                execute: () => cb.onSummarize(),
            },

            // ── Context ─────────────────────────────────────────
            {
                name: 'history',
                label: '/history',
                description: 'Set context history length (0 = none, -1 = all)',
                icon: '📚',
                group: 'Context',
                hasArgs: true,
                argsPlaceholder: '<number>',
                execute: (args) => cb.onHistory(args),
            },
            {
                name: 'fresh',
                label: '/fresh',
                description: 'Next message sends without any history context',
                icon: '✨',
                group: 'Context',
                execute: () => cb.onFresh(),
            },

            // ── View ────────────────────────────────────────────
            {
                name: 'fold',
                label: '/fold',
                description: 'Fold current visible chat',
                icon: '📁',
                group: 'View',
                execute: () => cb.onFoldCurrent(),
            },
            {
                name: 'foldall',
                label: '/foldall',
                description: 'Fold all chats',
                icon: '📂',
                group: 'View',
                execute: () => cb.onFoldAll(),
            },
            {
                name: 'unfoldall',
                label: '/unfoldall',
                description: 'Unfold all chats',
                icon: '📖',
                group: 'View',
                execute: () => cb.onUnfoldAll(),
            },
            {
                name: 'top',
                label: '/top',
                description: 'Scroll to the beginning of conversation',
                icon: '⬆️',
                group: 'View',
                execute: () => cb.onTop(),
            },
            {
                name: 'bottom',
                label: '/bottom',
                description: 'Scroll to the latest message',
                icon: '⬇️',
                group: 'View',
                execute: () => cb.onBottom(),
            },
            {
                name: 'nav',
                label: '/nav',
                description: 'Toggle chat navigator panel',
                icon: '🧭',
                group: 'View',
                execute: () => cb.onNav(),
            },

            // ── Tools ───────────────────────────────────────────
            {
                name: 'copy',
                label: '/copy',
                description: 'Copy all messages as Markdown',
                icon: '📋',
                group: 'Tools',
                execute: () => cb.onCopyAll(),
            },
            {
                name: 'export',
                label: '/export',
                description: 'Export conversation as Markdown',
                icon: '📤',
                group: 'Tools',
                execute: () => cb.onExport(),
            },
            {
                name: 'print',
                label: '/print',
                description: 'Print conversation',
                icon: '🖨️',
                group: 'Tools',
                execute: () => cb.onPrint(),
            },

            // ── Branch ──────────────────────────────────────────
            {
                name: 'branch',
                label: '/branch',
                description: 'Create new branch from current point',
                icon: '🌿',
                group: 'Branch',
                execute: () => cb.onCreateBranch(),
            },
            {
                name: 'switch',
                label: '/switch',
                description: 'Switch to a branch by name',
                icon: '🔀',
                group: 'Branch',
                hasArgs: true,
                argsPlaceholder: '<branch-name>',
                execute: (args) => { if (args) cb.onSwitchBranch(args); },
            },
            {
                name: 'branchprev',
                label: '/branchprev',
                description: 'Switch to previous branch',
                icon: '⏮️',
                group: 'Branch',
                execute: () => cb.onBranchPrev(),
            },
            {
                name: 'branchnext',
                label: '/branchnext',
                description: 'Switch to next branch',
                icon: '⏭️',
                group: 'Branch',
                execute: () => cb.onBranchNext(),
            },
            {
                name: 'branches',
                label: '/branches',
                description: 'List all branches with current indicator',
                icon: '📋',
                group: 'Branch',
                execute: () => cb.onListBranches(),
            },
            {
                name: 'renamebranch',
                label: '/renamebranch',
                description: 'Rename a branch',
                icon: '✏️',
                group: 'Branch',
                hasArgs: true,
                argsPlaceholder: '<old-name> <new-name>',
                execute: (args) => cb.onRenameBranch(args),
            },
            {
                name: 'deletebranch',
                label: '/deletebranch',
                description: 'Delete a branch and its unique messages',
                icon: '🗑️',
                group: 'Branch',
                hasArgs: true,
                argsPlaceholder: '<branch-name>',
                execute: (args) => { if (args) cb.onDeleteBranch(args); },
            },

            // ── Settings ────────────────────────────────────────
            {
                name: 'agent',
                label: '/agent',
                description: 'Switch to a different agent',
                icon: '🤖',
                group: 'Settings',
                hasArgs: true,
                argsPlaceholder: '<agent-id>',
                execute: (args) => { if (args) cb.onSwitchAgent(args); },
            },
            {
                name: 'model',
                label: '/model',
                description: 'Switch to a different model',
                icon: '🧠',
                group: 'Settings',
                hasArgs: true,
                argsPlaceholder: '<model-id>',
                execute: (args) => { if (args) cb.onModel(args); },
            },

            // ── Help ────────────────────────────────────────────
            {
                name: 'help',
                label: '/help',
                description: 'Show all available commands',
                icon: '❓',
                group: 'Help',
                execute: () => cb.onHelp(),
            },
        ];
    }

    // ================================================================
    // 工具
    // ================================================================

    private commandsToPopupItems(commands: SlashCommandDef[]): PopupItem[] {
        return commands.map(cmd => ({
            id: cmd.name,
            label: cmd.label,
            description: cmd.description,
            icon: cmd.icon,
            group: cmd.group,
            searchText: `${cmd.name} ${cmd.description}`,
            hasArgs: cmd.hasArgs,
        }));
    }

    // ================================================================
    // 生命周期
    // ================================================================

    deactivate(): void {
        this.panel?.destroy();
        this.panel = null;
        this.ctx = null;
        this.commands = [];
    }
}
