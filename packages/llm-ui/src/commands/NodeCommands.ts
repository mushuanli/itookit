// @file: llm-ui/commands/NodeCommands.ts

import { Command } from './Command';
import type { ErrorSeverity } from '../utils/errorHandler';
import type { SessionGroup } from '@itookit/llm-engine';

/**
 * 在 sessions 列表和执行树中查找 session
 */
function findSession(sessions: SessionGroup[], nodeId: string): SessionGroup | undefined {
    return sessions.find(s => s.id === nodeId)
        || sessions.find(s =>
            s.executionRoot?.id === nodeId || findInTree(s.executionRoot, nodeId)
        )
        // After deleting an assistant, its UI bubble may still be in the
        // remove animation while the Round projection already contains only
        // the user. The persisted Round ID is shared by both projections, so
        // recover the user as the resend target.
        || sessions.find(s => s.role === 'user' && s.persistedNodeId === nodeId);
}

function findInTree(node: any, targetId: string): boolean {
    if (!node) return false;
    if (node.id === targetId) return true;
    return node.children?.some((c: any) => findInTree(c, targetId)) ?? false;
}

/**
 * 重新生成命令（统一 retry + resend）
 *
 * 行为：
 * - 如果目标是 assistant 消息 → session.regenerate
 * - 如果目标是 user 消息 → session.regenerate-from-user
 * - 两者都会创建分支，不破坏现有对话路径
 */
export class RegenerateCommand extends Command<{ nodeId: string }> {
    protected readonly name = 'Regenerate';
    private running = false;

    protected async execute({ nodeId }: { nodeId: string }): Promise<void> {
        // A single physical click must submit at most one regenerate task,
        // even if a stale UI delegate dispatches the action twice.
        if (this.running) return;
        this.running = true;
        try {
            const sessions = await this.ctx.commands.execute<SessionGroup[]>('session.get-sessions');
            const session = findSession(sessions, nodeId);
            // A disappearing animated DOM node is not an engine failure.
            if (!session) return;

            const check = await this.ctx.commands.execute<{ allowed: boolean; reason?: string }>(
                'session.can-regenerate', { messageId: session.id }
            );
            if (!check.allowed) throw new Error(check.reason || 'Cannot regenerate');

            this.ctx.chatInput.setLoading(true);

            if (session.role === 'user') {
                // User bubbles do not own an executionRoot. Pass the currently
                // selected Agent explicitly; the engine still prefers persisted
                // Round metadata when callers omit this option (legacy/API use).
                const agentId = this.ctx.chatInput.getConfig().agentId;
                await this.ctx.commands.execute('session.regenerate-from-user', {
                    userMessageId: session.id,
                    options: agentId ? { agentId } : undefined,
                });
            } else {
                await this.ctx.commands.execute('session.regenerate', { assistantId: session.id });
            }
        } finally {
            this.running = false;
        }
    }
}

export class DeleteMessageCommand extends Command<{ nodeId: string }> {
    protected readonly name = 'Delete Message';

    protected async execute({ nodeId }: { nodeId: string }): Promise<void> {
        const previewIds = await this.previewDeletionIds(nodeId);
        this.ctx.historyView.removeMessages(previewIds, true);

        try {
            await this.ctx.commands.execute('session.delete-message', {
                messageId: nodeId,
                options: { deleteAssociatedResponses: true },
            });
        } catch (e) {
            // 删除失败：回滚 UI
            const sessions = await this.ctx.commands.execute<SessionGroup[]>('session.get-sessions');
            this.ctx.historyView.renderFull(sessions);
            throw e;
        }
    }

    private async previewDeletionIds(nodeId: string): Promise<string[]> {
        const sessions = await this.ctx.commands.execute<SessionGroup[]>('session.get-sessions');
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
        const sessions = await this.ctx.commands.execute<SessionGroup[]>('session.get-sessions');
        const session = sessions.find(s => s.id === nodeId);
        if (!session || session.role !== 'user') return;

        this.ctx.chatInput.setLoading(true);
        await this.ctx.commands.execute('session.commit-edit', {
            messageId: nodeId,
            newContent: session.content || '',
            autoRerun: true,
        });
    }
}

export class SiblingSwitchCommand extends Command<{ nodeId: string; direction: 'prev' | 'next' }> {
    protected readonly name = 'Switch Sibling';
    protected severity: ErrorSeverity = 'warn';

    protected async execute({ nodeId, direction }: {
        nodeId: string; direction: 'prev' | 'next';
    }): Promise<void> {
        const sessions = await this.ctx.commands.execute<SessionGroup[]>('session.get-sessions');
        const session = sessions.find(s => s.id === nodeId);
        if (!session) return;

        const currentIndex = session.siblingIndex ?? 0;
        const total = session.siblingCount ?? 1;
        const newIndex = direction === 'prev'
            ? Math.max(0, currentIndex - 1)
            : Math.min(total - 1, currentIndex + 1);

        if (newIndex !== currentIndex) {
            await this.ctx.commands.execute('session.switch-sibling', { messageId: nodeId, siblingIndex: newIndex });
        }
    }
}
