// @file: llm-ui/commands/BatchCommands.ts

import { Command } from '../base/core/Command';
import { Toast, showConfirmDialog } from '@itookit/common';
import { extractExecutionOutput } from '../utils/textUtils';

export class BatchDeleteCommand extends Command<{ ids: string[] }> {
    protected name = 'Batch Delete';

    protected async execute({ ids }: { ids: string[] }): Promise<void> {
        if (ids.length === 0) return;

        const confirmed = await showConfirmDialog(
            `Are you sure you want to delete ${ids.length} messages?`
        );
        if (!confirmed) return;

        const originalSessions = this.ctx.sessionManager.getSessions();

        try {
            this.ctx.historyView.removeMessages(ids, true);
            await this.ctx.sessionManager.deleteMessages(ids, {
                deleteAssociatedResponses: true,
            });
            Toast.success(`Deleted ${ids.length} message${ids.length > 1 ? 's' : ''}`);
        } catch (e) {
            this.ctx.historyView.renderFull(originalSessions);
            throw e;
        }
    }
}

export class BatchCopyCommand extends Command<{ ids: string[] }> {
    protected name = 'Batch Copy';

    protected async execute({ ids }: { ids: string[] }): Promise<void> {
        if (ids.length === 0) return;

        const sessions = this.ctx.sessionManager.getSessions();
        const sorted = ids.sort((a, b) => {
            const sA = sessions.find(s => s.id === a);
            const sB = sessions.find(s => s.id === b);
            return (sA?.timestamp || 0) - (sB?.timestamp || 0);
        });

        const content = sorted
            .map(id => {
                const s = sessions.find(s => s.id === id);
                if (!s) return null;
                let text = s.content || '';
                if (s.role === 'assistant' && s.executionRoot) {
                    text = extractExecutionOutput(s.executionRoot);
                }
                const role = s.role === 'user' ? 'User' : 'Assistant';
                const time = new Date(s.timestamp).toLocaleString();
                return `### ${role} (${time}):\n${text}`;
            })
            .filter(Boolean);

        await navigator.clipboard.writeText(content.join('\n\n---\n\n'));
        Toast.success(`Copied ${ids.length} messages`);
    }
}