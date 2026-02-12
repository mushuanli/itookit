// @file: llm-ui/helpers/NodeActionHandler.ts

import { SessionManager, ExecutionNode } from '@itookit/llm-engine';
import { HistoryView } from '../components/HistoryView';
import { ChatInput } from '../components/ChatInput';
import { NodeAction } from '../core/types';

export class NodeActionHandler {
    constructor(
        private sessionManager: SessionManager,
        private historyView: HistoryView,
        private chatInput: ChatInput
    ) { }

    async handleAction(action: NodeAction, nodeId: string): Promise<void> {
        try {
            switch (action) {
                case 'retry':
                    return await this.handleRetry(nodeId);
                case 'delete':
                    return await this.handleDelete(nodeId);
                case 'edit-and-retry':
                    return await this.handleEditAndRetry(nodeId);
                case 'resend':
                    return await this.handleResend(nodeId);
                case 'prev-sibling':
                case 'next-sibling':
                    return await this.handleSiblingSwitch(
                        nodeId,
                        action === 'prev-sibling' ? 'prev' : 'next'
                    );
            }
        } catch (e: any) {
            console.error('[NodeActionHandler] Action failed:', e);
            this.historyView.renderError(e);
        }
    }

    private get fallbackAgentId(): string {
        return this.chatInput.getSelectedExecutor() || 'default';
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
            this.historyView.renderError(new Error('Message not found'));
            return;
        }

        const canRetry = this.sessionManager.canRetry(session.id);
        if (!canRetry.allowed) {
            console.warn(`[NodeActionHandler] Cannot retry: ${canRetry.reason}`);
            return;
        }

        this.chatInput.setLoading(true);

        try {
            if (session.role === 'user') {
                await this.sessionManager.resendUserMessage(
                    session.id, undefined, this.fallbackAgentId
                );
            } else {
                await this.sessionManager.retryGeneration(
                    session.id,
                    undefined,
                    this.fallbackAgentId,
                    true // preserveCurrent
                );
            }
        } catch (e: any) {
            console.error('[NodeActionHandler] Retry failed:', e);
            this.historyView.renderError(e);
            this.chatInput.setLoading(false);
        }
    }

    private async handleDelete(nodeId: string): Promise<void> {
        try {
            // 预估 ID 用于乐观 UI 更新
            const previewIds = this.previewDeletionIds(nodeId);
            this.historyView.removeMessages(previewIds, true);

            await this.sessionManager.deleteMessage(nodeId, {
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
            // ✅ editMessage(id, content, autoRerun=true) 内部自动：
            //   1. 更新消息内容
            //   2. 持久化
            //   3. 删除关联 assistant 响应
            //   4. 重新提交
            await this.sessionManager.editMessage(nodeId, session.content || '', true);
        } catch (e: any) {
            console.error('[NodeActionHandler] Edit and retry failed:', e);
            this.historyView.renderError(e);
            this.chatInput.setLoading(false);
        }
    }

    private async handleResend(nodeId: string): Promise<void> {
        this.chatInput.setLoading(true);
        try {
            await this.sessionManager.resendUserMessage(
                nodeId,
                undefined,
                this.fallbackAgentId
            );
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

        const newIndex = direction === 'prev'
            ? Math.max(0, currentIndex - 1)
            : Math.min(total - 1, currentIndex + 1);

        if (newIndex !== currentIndex) {
            try {
                // ✅ switchToSibling 内部自动：
                //   1. 获取兄弟节点列表
                //   2. updateManifestHead
                //   3. reloadSessionData
                //   4. 发送 sibling_switch 事件
                await this.sessionManager.switchToSibling(nodeId, newIndex);
            } catch (e: any) {
                console.error('[NodeActionHandler] Sibling switch failed:', e);
                this.historyView.renderError(e);
            }
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
