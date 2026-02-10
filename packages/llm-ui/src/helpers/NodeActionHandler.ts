// @file: llm-ui/helpers/NodeActionHandler.ts

import { SessionManager, SessionGroup, ExecutionNode } from '@itookit/llm-engine';
import { HistoryView } from '../components/HistoryView';
import { ChatInput } from '../components/ChatInput';
import { NodeAction } from '../core/types';

export class NodeActionHandler {
    constructor(
        private sessionManager: SessionManager,
        private historyView: HistoryView,
        private chatInput: ChatInput
    ) { }

    /**
     * 处理节点操作
     */
    async handleAction(action: NodeAction, nodeId: string): Promise<void> {
        try {
            switch (action) {
                case 'retry':
                    await this.handleRetry(nodeId);
                    break;
                case 'delete':
                    await this.handleDelete(nodeId);
                    break;
                case 'edit-and-retry':
                    await this.handleEditAndRetry(nodeId);
                    break;
                case 'resend':
                    await this.handleResend(nodeId);
                    break;
                case 'prev-sibling':
                case 'next-sibling':
                    await this.handleSiblingSwitch(nodeId, action === 'prev-sibling' ? 'prev' : 'next');
                    break;
            }
        } catch (e: any) {
            console.error('[NodeActionHandler] Action failed:', e);
            this.historyView.renderError(e);
        }
    }

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
            console.warn(`[NodeActionHandler] Cannot retry: session not found for ${nodeId}`);
            this.historyView.renderError(new Error('Message not found'));
            return;
        }

        const canRetry = this.sessionManager.canRetry(session.id);
        if (!canRetry.allowed) {
            console.warn(`[NodeActionHandler] Cannot retry: ${canRetry.reason}`);
            return;
        }

        this.chatInput.setLoading(true);

        const fallbackAgentId = this.chatInput.getSelectedExecutor() || 'default';

        try {
            if (session.role === 'user') {
                await this.sessionManager.resendUserMessage(session.id, {
                    fallbackAgentId
                });
            } else {
                await this.sessionManager.retryGeneration(session.id, {
                    preserveCurrent: true,
                    navigateToNew: true,
                    fallbackAgentId
                });
            }
        } catch (e: any) {
            console.error('[NodeActionHandler] Retry failed:', e);
            this.historyView.renderError(e);
            this.chatInput.setLoading(false);
        }
    }

    private async handleDelete(nodeId: string): Promise<void> {
        console.log(`[NodeActionHandler] Deleting: ${nodeId}`);

        try {
            const sessions = this.sessionManager.getSessions();
            const idsToDelete = this.collectDeletionIds(nodeId, sessions);

            console.log(`[NodeActionHandler] IDs to delete:`, idsToDelete);

            // 乐观更新
            this.historyView.removeMessages(idsToDelete, true);

            await this.sessionManager.deleteMessage(nodeId, {
                mode: 'soft',
                cascade: false,
                deleteAssociatedResponses: true
            });

        } catch (e: any) {
            console.error('[NodeActionHandler] Delete failed:', e);

            // 回滚
            const sessions = this.sessionManager.getSessions();
            this.historyView.renderFull(sessions);
            this.historyView.renderError(e);
        }
    }

    private async handleEditAndRetry(nodeId: string): Promise<void> {
        const session = this.sessionManager.getSessions().find(s => s.id === nodeId);
        if (!session || session.role !== 'user') return;

        this.chatInput.setLoading(true);
        try {
            await this.sessionManager.editMessage(nodeId, session.content || '', true);
        } catch (e: any) {
            console.error('[NodeActionHandler] Edit and retry failed:', e);
            this.historyView.renderError(e);
            this.chatInput.setLoading(false);
        }
    }

    private async handleResend(nodeId: string): Promise<void> {
        this.chatInput.setLoading(true);

        const fallbackAgentId = this.chatInput.getSelectedExecutor() || 'default';

        try {
            await this.sessionManager.resendUserMessage(nodeId, {
                fallbackAgentId
            });
        } catch (e: any) {
            console.error('[NodeActionHandler] Resend failed:', e);
            this.historyView.renderError(e);
            this.chatInput.setLoading(false);
        }
    }

    private async handleSiblingSwitch(nodeId: string, direction: 'prev' | 'next'): Promise<void> {
        const sessions = this.sessionManager.getSessions();
        const session = sessions.find(s => s.id === nodeId);
        if (!session) return;

        const currentIndex = session.siblingIndex ?? 0;
        const total = session.siblingCount ?? 1;

        let newIndex: number;
        if (direction === 'prev') {
            newIndex = Math.max(0, currentIndex - 1);
        } else {
            newIndex = Math.min(total - 1, currentIndex + 1);
        }

        if (newIndex !== currentIndex) {
            try {
                await this.sessionManager.switchToSibling(nodeId, newIndex);
            } catch (e: any) {
                console.error('[NodeActionHandler] Sibling switch failed:', e);
                this.historyView.renderError(e);
            }
        }
    }

    private findNodeInTree(node: ExecutionNode | undefined, targetId: string): boolean {
        if (!node) return false;
        if (node.id === targetId) return true;
        return node.children?.some(c => this.findNodeInTree(c, targetId)) ?? false;
    }

    private collectDeletionIds(nodeId: string, sessions: SessionGroup[]): string[] {
        const ids: string[] = [nodeId];

        const targetIndex = sessions.findIndex(s => s.id === nodeId);
        if (targetIndex === -1) return ids;

        const target = sessions[targetIndex];

        if (target.role === 'user') {
            for (let i = targetIndex + 1; i < sessions.length; i++) {
                const s = sessions[i];
                if (s.role === 'assistant') {
                    ids.push(s.id);
                    if (s.executionRoot) {
                        this.collectNodeIds(s.executionRoot, ids);
                    }
                } else {
                    break;
                }
            }
        }

        return ids;
    }

    private collectNodeIds(node: ExecutionNode, ids: string[]): void {
        ids.push(node.id);
        if (node.children) {
            for (const child of node.children) {
                this.collectNodeIds(child, ids);
            }
        }
    }
}
