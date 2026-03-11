// @file: llm-ui/commands/FoldCommands.ts

import { Command } from '../base/core/Command';
import type { ErrorSeverity } from '../utils/errorHandler';

export class FoldAllCommand extends Command {
    protected readonly name = 'Fold All';
    protected severity: ErrorSeverity = 'silent';

    protected async execute(): Promise<void> {
        const sessions = this.ctx.sessionManager.getSessions();
        const states: Record<string, boolean> = {};
        sessions.forEach(s => { states[s.id] = true; });

        // 批量设置折叠
        this.ctx.historyView.setAllCollapsed(true);
        this.ctx.bus.emit('state:collapseChanged', { states });
    }
}

export class UnfoldAllCommand extends Command {
    protected readonly name = 'Unfold All';
    protected severity: ErrorSeverity = 'silent';

    protected async execute(): Promise<void> {
        const sessions = this.ctx.sessionManager.getSessions();
        const states: Record<string, boolean> = {};
        sessions.forEach(s => { states[s.id] = false; });

        this.ctx.historyView.setAllCollapsed(false);
        this.ctx.bus.emit('state:collapseChanged', { states });
    }
}

export class ToggleSessionFoldCommand extends Command<{ sessionId: string }> {
    protected readonly name = 'Toggle Session Fold';
    protected severity: ErrorSeverity = 'silent';

    protected async execute({ sessionId }: { sessionId: string }): Promise<void> {
        this.ctx.historyView.toggleSessionCollapse(sessionId);
    }
}