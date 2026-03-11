// @file: llm-ui/commands/ContentCommands.ts

import { Command } from '../base/core/Command';
import { Toast } from '@itookit/common';
import { extractExecutionOutput } from '../utils/textUtils';

export class CopySessionContentCommand extends Command<{ sessionId: string }> {
    protected name = 'Copy Session Content';

    protected async execute({ sessionId }: { sessionId: string }): Promise<void> {
        const sessions = this.ctx.sessionManager.getSessions();
        const session = sessions.find(s => s.id === sessionId);
        if (!session) return;

        let content = session.content || '';
        if (session.role === 'assistant' && session.executionRoot) {
            content = extractExecutionOutput(session.executionRoot);
        }

        await navigator.clipboard.writeText(content);
        Toast.success('Copied to clipboard');
    }
}
