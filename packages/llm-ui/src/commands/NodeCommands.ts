// @file: llm-ui/commands/NodeCommands.ts

import { Command } from '../base/core/Command';
import type { ErrorSeverity } from '../utils/errorHandler';
import type { SessionGroup } from '@itookit/llm-engine';

/**
 * 在 sessions 列表和执行树中查找 session
 */
function findSession(sessions: SessionGroup[], nodeId: string): SessionGroup | undefined {
    return sessions.find(s => s.id === nodeId)
        || sessions.find(s =>
            s.executionRoot?.id === nodeId || findInTree(s.executionRoot, nodeId)
        );
}

function findInTree(node: any, targetId: string): boolean {
    if (!node) return false;
    if (node.id === targetId) return true;
    return node.children?.some((c: any) => findInTree(c, targetId)) ?? false;
}

export class RetryCommand extends Command<{ nodeId: string }> {
    protected readonly name = 'Retry';

    protected async execute({ nodeId }: { nodeId: string }): Promise<void> {
        const session = findSession(this.ctx.sessionManager.getSessions(), nodeId);
        if (!session) throw new Error('Message not found');

        const canRetry = this.ctx.sessionManager.canRetry(session.id);
        if (!canRetry.allowed) throw new Error(canRetry.reason || 'Cannot retry');

        this.ctx.chatInput.setLoading(true);

        // 不传 agentId — 引擎自动从上下文解析
        if (session.role === 'user') {
            await this.ctx.sessionManager.resendUserMessage(session.id);
        } else {
            await this.ctx.sessionManager.retryGeneration(session.id);
        }
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
            this.ctx.historyView.renderFull(this.ctx.sessionManager.getSessions());
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
        await this.ctx.sessionManager.resendUserMessage(nodeId);
    }
}

export class SiblingSwitchCommand extends Command<{ nodeId: string; direction: 'prev' | 'next' }> {
    protected readonly name = 'Switch Sibling';
    protected severity: ErrorSeverity = 'warn';

    protected async execute({ nodeId, direction }: {
        nodeId: string; direction: 'prev' | 'next';
    }): Promise<void> {
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
