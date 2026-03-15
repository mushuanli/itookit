// @file: llm-ui/commands/WorkspaceCommands.ts

import { Command } from './Command';
import { LLMPrintService, type PrintService } from '@itookit/mdxeditor';
import type { ErrorSeverity } from '../utils/errorHandler';

/**
 * 复制整个会话为 Markdown
 */
export class CopyAllCommand extends Command {
    protected readonly name = 'Copy All';
    protected severity: ErrorSeverity = 'toast';

    protected async execute(): Promise<void> {
        const md = this.ctx.sessionManager.exportToMarkdown();
        await navigator.clipboard.writeText(md);
    }
}

/**
 * 打印会话
 */
export class PrintCommand extends Command<{ title: string; engine: any; nodeId?: string }> {
    protected readonly name = 'Print';
    protected severity: ErrorSeverity = 'warn';

    private printService: PrintService | null = null;

    protected async execute({ title, engine, nodeId }: {
        title: string; engine: any; nodeId?: string;
    }): Promise<void> {
        const md = this.ctx.sessionManager.exportToMarkdown();
        if (!this.printService) {
            this.printService = new LLMPrintService(engine, nodeId);
        }
        await this.printService.print(md, {
            title: title || 'Chat Conversation',
            showHeader: true,
            headerMeta: { date: new Date().toLocaleString() },
        });
    }
}
