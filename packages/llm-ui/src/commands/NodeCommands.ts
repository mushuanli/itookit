// @file: llm-ui/commands/NodeCommands.ts

import { Command } from '../base/core/Command';
import type { ErrorSeverity } from '../utils/errorHandler';

export class RetryCommand extends Command<{ nodeId: string }> {
    protected readonly name = 'Retry';

    protected async execute({ nodeId }: { nodeId: string }): Promise<void> {
        const sessions = this.ctx.sessionManager.getSessions();
        const session = sessions.find(s => s.id === nodeId)
            || sessions.find(s =>
                s.executionRoot?.id === nodeId || this.findInTree(s.executionRoot, nodeId)
            );

        if (!session) throw new Error('Message not found');

        const canRetry = this.ctx.sessionManager.canRetry(session.id);
        if (!canRetry.allowed) throw new Error(canRetry.reason || 'Cannot retry');

        this.ctx.chatInput.setLoading(true);
        const agentId = this.ctx.chatInput.getSelectedExecutor() || 'default';

        if (session.role === 'user') {
            await this.ctx.sessionManager.resendUserMessage(session.id, undefined, agentId);
        } else {
            await this.ctx.sessionManager.retryGeneration(session.id, undefined, agentId, true);
        }
    }

    private findInTree(node: any, targetId: string): boolean {
        if (!node) return false;
        if (node.id === targetId) return true;
        return node.children?.some((c: any) => this.findInTree(c, targetId)) ?? false;
    }
}

export class DeleteMessageCommand extends Command<{ nodeId: string }> {
    protected readonly name = 'Delete Message';

    protected async execute({ nodeId }: { nodeId: string }): Promise<void> {
        const previewIds = this.previewDeletionIds(nodeId);
        this.ctx.historyView.removeMessages(previewIds, true);

        try {
            await this.ctx.sessionManager.deleteMessage(nodeId, {
                deleteAssociatedResponses: true,
            });
        } catch (e) {
            // 删除失败：回滚 UI
            const sessions = this.ctx.sessionManager.getSessions();
            this.ctx.historyView.renderFull(sessions);
            throw e;
        }
    }

    private previewDeletionIds(nodeId: string): string[] {
        const sessions = this.ctx.sessionManager.getSessions();
        const ids = [nodeId];
        const idx = sessions.findIndex(s => s.id === nodeId);
        if (idx === -1) return ids;

        if (sessions[idx].role === 'user') {
            for (let i = idx + 1; i < sessions.length; i++) {
                if (sessions[i].role !== 'assistant') break;
                ids.push(sessions[i].id);
            }
        }
        return ids;
    }
}

export class EditAndRetryCommand extends Command<{ nodeId: string }> {
    protected readonly name = 'Edit and Retry';

    protected async execute({ nodeId }: { nodeId: string }): Promise<void> {
        const session = this.ctx.sessionManager.getSessions().find(s => s.id === nodeId);
        if (!session || session.role !== 'user') return;

        this.ctx.chatInput.setLoading(true);
        await this.ctx.sessionManager.editMessage(nodeId, session.content || '', true);
    }
}

export class ResendCommand extends Command<{ nodeId: string }> {
    protected readonly name = 'Resend';

    protected async execute({ nodeId }: { nodeId: string }): Promise<void> {
        this.ctx.chatInput.setLoading(true);
        const agentId = this.ctx.chatInput.getSelectedExecutor() || 'default';
        await this.ctx.sessionManager.resendUserMessage(nodeId, undefined, agentId);
    }
}

export class SiblingSwitchCommand extends Command<{ nodeId: string; direction: 'prev' | 'next' }> {
    protected readonly name = 'Switch Sibling';
    protected severity: ErrorSeverity = 'warn';

    protected async execute({ nodeId, direction }: { nodeId: string; direction: 'prev' | 'next' }): Promise<void> {
        const session = this.ctx.sessionManager.getSessions().find(s => s.id === nodeId);
        if (!session) return;

        const currentIndex = session.siblingIndex ?? 0;
        const total = session.siblingCount ?? 1;
        const newIndex = direction === 'prev'
            ? Math.max(0, currentIndex - 1)
            : Math.min(total - 1, currentIndex + 1);

        if (newIndex !== currentIndex) {
            await this.ctx.sessionManager.switchToSibling(nodeId, newIndex);
        }
    }
}
