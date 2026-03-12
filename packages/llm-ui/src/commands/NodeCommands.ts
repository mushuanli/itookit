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

/**
 * 重新生成命令（统一 retry + resend）
 *
 * 行为：
 * - 如果目标是 assistant 消息 → regenerate(assistantId)
 * - 如果目标是 user 消息 → regenerateFromUser(userId)
 * - 两者都会创建分支，不破坏现有对话路径
 */
export class RegenerateCommand extends Command<{ nodeId: string }> {
    protected readonly name = 'Regenerate';

    protected async execute({ nodeId }: { nodeId: string }): Promise<void> {
        const sessions = this.ctx.sessionManager.getSessions();
        const session = findSession(sessions, nodeId);
        if (!session) throw new Error('Message not found');

        const check = this.ctx.sessionManager.canRegenerate(session.id);
        if (!check.allowed) throw new Error(check.reason || 'Cannot regenerate');

        this.ctx.chatInput.setLoading(true);

        // 根据角色自动路由
        if (session.role === 'user') {
            await this.ctx.sessionManager.regenerateFromUser(session.id);
        } else {
            await this.ctx.sessionManager.regenerate(session.id);
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
        // ✅ 使用 commitEdit 替代 editMessage
        await this.ctx.sessionManager.commitEdit(nodeId, session.content || '', true);
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
