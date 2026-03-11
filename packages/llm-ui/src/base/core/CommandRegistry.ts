// @file: llm-ui/core/CommandRegistry.ts

import { Command, CommandContext } from './Command';
import { EditorEventBus, EditorBusEvents } from './EditorEventBus';

import {
    CreateBranchCommand, SwitchBranchCommand, SwitchBranchByIdCommand,
    RenameBranchCommand, DeleteBranchCommand, BatchDeleteCommand, BatchCopyCommand,
    CopySessionContentCommand, FoldAllCommand, UnfoldAllCommand, ToggleSessionFoldCommand,
    ScrollToSessionCommand
} from '../../commands/';

type CommandFactory = (ctx: CommandContext) => Command<any, any>;

/**
 * 命令注册中心
 *
 * 只注册 EventBus 驱动的命令。
 * 直接调用的命令（SendMessage、NodeActions、SwitchBranchByOffset）
 * 在 LLMWorkspaceEditor.initCommands() 中手动实例化。
 */
export class CommandRegistry {
    private commands = new Map<string, Command<any, any>>();
    private unsubscribers: (() => void)[] = [];

    constructor(
        private ctx: CommandContext,
        private bus: EditorEventBus
    ) { }

    /**
     * 注册所有命令并绑定到事件总线
     */
    initialize(): void {
        // 分支命令
        this.bind('branch:create', (ctx) => new CreateBranchCommand(ctx));
        this.bind('branch:switch', (ctx) => new SwitchBranchCommand(ctx));
        this.bind('branch:switchById', (ctx) => new SwitchBranchByIdCommand(ctx));
        this.bind('branch:rename', (ctx) => new RenameBranchCommand(ctx));
        this.bind('branch:delete', (ctx) => new DeleteBranchCommand(ctx));

        // 导航命令
        this.bind('nav:scrollTo', (ctx) => new ScrollToSessionCommand(ctx));
        this.bind('nav:toggleFold', (ctx) => new ToggleSessionFoldCommand(ctx));
        this.bind('nav:foldAll', (ctx) => new FoldAllCommand(ctx));
        this.bind('nav:unfoldAll', (ctx) => new UnfoldAllCommand(ctx));

        // 批量操作
        this.bind('batch:delete', (ctx) => new BatchDeleteCommand(ctx));
        this.bind('batch:copy', (ctx) => new BatchCopyCommand(ctx));

        // 内容操作
        this.bind('content:copy', (ctx) => new CopySessionContentCommand(ctx));

        // 状态持久化 — 直接绑定到 StateManager（不需要 Command 类）
        this.unsubscribers.push(
            this.bus.on('state:collapseChanged', ({ }) => {
                this.ctx.stateService; // 通过 UIController 处理
            })
        );
    }

    /**
     * 按名字执行命令
     */
    async execute<K extends string>(name: K, params: any): Promise<any> {
        const cmd = this.commands.get(name);
        if (!cmd) {
            console.warn(`[CommandRegistry] Unknown command: ${name}`);
            return;
        }
        return cmd.run(params);
    }

    private bind<K extends keyof EditorBusEvents>(
        event: K,
        factory: CommandFactory
    ): void {
        const cmd = factory(this.ctx);
        this.commands.set(event, cmd);
        this.unsubscribers.push(
            this.bus.on(event, (payload) => cmd.run(payload))
        );
    }

    destroy(): void {
        this.unsubscribers.forEach(unsub => unsub());
        this.unsubscribers = [];
        this.commands.clear();
    }
}
