// @file: llm-ui/helpers/NodeActionHandler.ts

import { SessionManager, ExecutionNode } from '@itookit/llm-engine';
import { HistoryView } from '../components/HistoryView';
import { ChatInput } from '../components/ChatInput';
import { NodeAction } from '../core/types';
import { ErrorHandler } from '../utils/errorHandler';

export class NodeActionHandler {
    // ✅ 改动：统一错误处理器
    private errorHandler: ErrorHandler;

    constructor(
        private sessionManager: SessionManager,
        private historyView: HistoryView,
        private chatInput: ChatInput
    ) {
        this.errorHandler = new ErrorHandler({
            module: 'NodeActionHandler',
            defaultSeverity: 'render',
            onRenderError: (err) => this.historyView.renderError(err),
            onResetLoading: () => this.chatInput.setLoading(false),
        });
    }

    // ✅ 改动：统一 wrap，移除每个方法中的 try-catch
    async handleAction(action: NodeAction, nodeId: string): Promise<void> {
        await this.errorHandler.wrap(
            () => this.executeAction(action, nodeId),
            `Action "${action}" on ${nodeId}`
        );
    }

    private async executeAction(action: NodeAction, nodeId: string): Promise<void> {
        switch (action) {
            case 'retry':
                return this.handleRetry(nodeId);
            case 'delete':
                return this.handleDelete(nodeId);
            case 'edit-and-retry':
                return this.handleEditAndRetry(nodeId);
            case 'resend':
                return this.handleResend(nodeId);
            case 'prev-sibling':
            case 'next-sibling':
                return this.handleSiblingSwitch(
                    nodeId,
                    action === 'prev-sibling' ? 'prev' : 'next'
                );
        }
    }

    private get fallbackAgentId(): string {
        return this.chatInput.getSelectedExecutor() || 'default';
    }

    // ✅ 改动：移除内部 try-catch，错误自动冒泡到 handleAction
    private async handleRetry(nodeId: string): Promise<void> {
        const sessions = this.sessionManager.getSessions();
        let session = sessions.find(s => s.id === nodeId);

        if (!session) {
            session = sessions.find(s =>
                s.executionRoot?.id === nodeId ||
                this.findNodeInTree(s.executionRoot, nodeId)
            );
        }

        if (!session) {
            throw new Error('Message not found');
        }

        const canRetry = this.sessionManager.canRetry(session.id);
        if (!canRetry.allowed) {
            throw new Error(canRetry.reason || 'Cannot retry');
        }

        this.chatInput.setLoading(true);

        if (session.role === 'user') {
            await this.sessionManager.resendUserMessage(
                session.id, undefined, this.fallbackAgentId
            );
        } else {
            await this.sessionManager.retryGeneration(
                session.id, undefined, this.fallbackAgentId, true
            );
        }
    }

    // ✅ 改动：移除内部 try-catch
    private async handleDelete(nodeId: string): Promise<void> {
        const previewIds = this.previewDeletionIds(nodeId);
        this.historyView.removeMessages(previewIds, true);

        try {
            await this.sessionManager.deleteMessage(nodeId, {
                deleteAssociatedResponses: true
            });
        } catch (e: any) {
            // 删除失败需要特殊处理：回滚 UI
            const sessions = this.sessionManager.getSessions();
            this.historyView.renderFull(sessions);
            throw e; // 重新抛出让 errorHandler 处理
        }
    }

    // ✅ 改动：移除内部 try-catch
    private async handleEditAndRetry(nodeId: string): Promise<void> {
        const session = this.sessionManager.getSessions().find(s => s.id === nodeId);
        if (!session || session.role !== 'user') return;

        this.chatInput.setLoading(true);
        await this.sessionManager.editMessage(nodeId, session.content || '', true);
    }

    // ✅ 改动：移除内部 try-catch
    private async handleResend(nodeId: string): Promise<void> {
        this.chatInput.setLoading(true);
        await this.sessionManager.resendUserMessage(
            nodeId, undefined, this.fallbackAgentId
        );
    }

    // ✅ 改动：移除内部 try-catch
    private async handleSiblingSwitch(nodeId: string, direction: 'prev' | 'next'): Promise<void> {
        const sessions = this.sessionManager.getSessions();
        const session = sessions.find(s => s.id === nodeId);
        if (!session) return;

        const currentIndex = session.siblingIndex ?? 0;
        const total = session.siblingCount ?? 1;

        const newIndex = direction === 'prev'
            ? Math.max(0, currentIndex - 1)
            : Math.min(total - 1, currentIndex + 1);

        if (newIndex !== currentIndex) {
            await this.sessionManager.switchToSibling(nodeId, newIndex);
        }
    }

    /**
     * 仅用于乐观 UI 更新的预估 ID 收集
     * 实际删除由 SessionManager 内部处理
     */
    private previewDeletionIds(nodeId: string): string[] {
        const sessions = this.sessionManager.getSessions();
        const ids: string[] = [nodeId];
        const targetIndex = sessions.findIndex(s => s.id === nodeId);
        if (targetIndex === -1) return ids;

        if (sessions[targetIndex].role === 'user') {
            for (let i = targetIndex + 1; i < sessions.length; i++) {
                if (sessions[i].role !== 'assistant') break;
                ids.push(sessions[i].id);
            }
        }

        return ids;
    }

    private findNodeInTree(node: ExecutionNode | undefined, targetId: string): boolean {
        if (!node) return false;
        if (node.id === targetId) return true;
        return node.children?.some(c => this.findNodeInTree(c, targetId)) ?? false;
    }
}
