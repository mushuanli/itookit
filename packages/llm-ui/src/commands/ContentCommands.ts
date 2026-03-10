// @file: llm-ui/commands/ContentCommands.ts

import { Command } from '../core/Command';
import { Toast } from '@itookit/common';

export class CopySessionContentCommand extends Command<{ sessionId: string }> {
    protected name = 'Copy Session Content';

    protected async execute({ sessionId }: { sessionId: string }): Promise<void> {
        const sessions = this.ctx.sessionManager.getSessions();
        const session = sessions.find(s => s.id === sessionId);
        if (!session) return;

        let content = session.content || '';
        if (session.role === 'assistant' && session.executionRoot) {
            content = this.extractOutput(session.executionRoot);
        }

        await navigator.clipboard.writeText(content);
        Toast.success('Copied to clipboard');
    }

    private extractOutput(node: any): string {
        let output = node.data?.output || '';
        for (const child of node.children || []) {
            const childOutput = this.extractOutput(child);
            if (childOutput) output += '\n\n' + childOutput;
        }
        return output.trim();
    }
}
