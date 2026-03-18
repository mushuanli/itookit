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
}

/**
 * Slash Command 回调接口
 * 
 * 将命令的实际执行委托给外部（Shell 层），
 * 插件本身不依赖 SessionManager 等业务对象。
 */
export interface SlashCommandCallbacks {
    onRetry: () => void;
    onClear: () => void;
    onExport: () => void;
    onCopyAll: () => void;
    onPrint: () => void;
    onCreateBranch: () => void;
    onSwitchAgent: (agentId: string) => void;
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
    readonly priority = 40; // 优先于 HistoryPlugin

    private ctx: InputPluginContext | null = null;
    private panel: PopupPanel | null = null;
    private commands: SlashCommandDef[] = [];
    //private isActive = false;

    constructor(callbacks: SlashCommandCallbacks) {
        this.commands = this.buildDefaultCommands(callbacks);
    }

    activate(ctx: InputPluginContext): void {
        console.log('[SlashPlugin] activate called');
        this.ctx = ctx;

        this.panel = new PopupPanel(ctx.textarea, {
            maxVisible: 12,
            showSearch: false, // 搜索由输入框本身驱动
            emptyText: 'No matching commands',
            footerHint: '↑↓ Navigate · Enter Execute · Esc Close',
            variant: 'slash',
            animated: true,
        });

        console.log(`[SlashPlugin] Panel created, ${this.commands.length} commands registered`);
    }

    // ================================================================
    // 注册自定义命令
    // ================================================================

    /**
     * 注册额外命令（供外部扩展）
     */
    registerCommand(command: SlashCommandDef): void {
        // 去重
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
        // 面板已打开时：由面板处理导航
        if (this.panel?.isVisible) {
            console.debug(`[SlashPlugin] Panel visible, handling key: ${e.key}`);
            if (this.panel.handleKeyDown(e)) {
                return true;
            }

            // Esc 关闭
            if (e.key === 'Escape') {
                this.closePanel();
                return true;
            }

            // 其他键：继续输入（会触发 onInput 更新过滤）
            return false;
        }

        return false;
    }

    // ================================================================
    // 输入钩子
    // ================================================================

    onInput(text: string, _cursorPos: number): void {
        // 检测是否以 / 开头
        if (text.startsWith('/')) {
            const query = text.slice(1).split(/\s/)[0];
            console.log(`[SlashPlugin] Slash detected, query: "${query}"`);
            this.showCommands(query);
        } else if (this.panel?.isVisible) {
            console.log('[SlashPlugin] No slash prefix, closing panel');
            this.closePanel();
        }
    }

    // ================================================================
    // 发送前钩子
    // ================================================================

    onBeforeSend(text: string): boolean | void {
        // 拦截 slash 命令（不作为普通消息发送）
        if (!text.startsWith('/')) return;

        const match = text.match(/^\/(\S+)\s*(.*)/);
        if (!match) return;

        const [, cmdName, args] = match;
        const command = this.commands.find(c => c.name === cmdName);

        if (command) {
            this.executeCommand(command, args.trim());
            return false; // 阻止发送
        }

        // 未匹配到命令：允许正常发送（用户可能就是要发 / 开头的文本）
        return;
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
            //this.isActive = true;
        }

        // 实时过滤
        this.panel.filter(query);
    }

    private handleSelect(item: PopupItem): void {
        if (!this.ctx) return;

        const command = this.commands.find(c => c.name === item.id);
        if (!command) return;

        if (command.hasArgs) {
            // 有参数的命令：填入命令+占位符，等用户补充
            const placeholder = command.argsPlaceholder || '';
            this.ctx.setText(`/${command.name} ${placeholder}`);
            this.ctx.focus();

            // 选中占位符部分
            const start = command.name.length + 2;
            this.ctx.setCursorPosition(start);
        } else {
            // 无参数：直接执行
            this.ctx.setText('');
            this.executeCommand(command, '');
        }
    }

    private async executeCommand(command: SlashCommandDef, args: string): Promise<void> {
        if (!this.ctx) return;

        try {
            await command.execute(args, this.ctx);
        } catch (e) {
            console.error(`[SlashCommand] Failed to execute /${command.name}:`, e);
        }

        // 执行后清空输入
        this.ctx.setText('');
        this.ctx.focus();
    }

    private closePanel(): void {
        this.panel?.hide();
        //this.isActive = false;
    }

    // ================================================================
    // 默认命令注册
    // ================================================================

    private buildDefaultCommands(cb: SlashCommandCallbacks): SlashCommandDef[] {
        return [
            {
                name: 'retry',
                label: '/retry',
                description: 'Regenerate last response',
                icon: '🔄',
                group: 'Common',
                execute: () => cb.onRetry(),
            },
            {
                name: 'clear',
                label: '/clear',
                description: 'Clear conversation history',
                icon: '🗑️',
                group: 'Common',
                execute: () => cb.onClear(),
            },
            {
                name: 'export',
                label: '/export',
                description: 'Export as Markdown',
                icon: '📤',
                group: 'Tools',
                execute: () => cb.onExport(),
            },
            {
                name: 'copy',
                label: '/copy',
                description: 'Copy all messages',
                icon: '📋',
                group: 'Tools',
                execute: () => cb.onCopyAll(),
            },
            {
                name: 'print',
                label: '/print',
                description: 'Print conversation',
                icon: '🖨️',
                group: 'Tools',
                execute: () => cb.onPrint(),
            },
            {
                name: 'branch',
                label: '/branch',
                description: 'Create new branch',
                icon: '🌿',
                group: 'Branch',
                execute: () => cb.onCreateBranch(),
            },
            {
                name: 'agent',
                label: '/agent',
                description: 'Switch to agent',
                icon: '🤖',
                group: 'Settings',
                hasArgs: true,
                argsPlaceholder: '<agent-id>',
                execute: (args) => {
                    if (args) cb.onSwitchAgent(args);
                },
            },
            {
                name: 'help',
                label: '/help',
                description: 'Show available commands',
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
