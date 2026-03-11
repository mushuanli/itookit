// @file: llm-ui/commands/SendMessageCommand.ts

import { Command } from '../base/core/Command';
import { Toast } from '@itookit/common';
import { ErrorHandler } from '../utils/errorHandler';
import type { ChatOverrides } from '../views/ChatInputView';

export interface SendMessageParams {
    text: string;
    files: File[];
    agentId?: string;
    overrides?: ChatOverrides;
}

export class SendMessageCommand extends Command<SendMessageParams> {
    protected name = 'Send Message';

    protected async execute({ text, files, agentId, overrides }: SendMessageParams): Promise<void> {
        const ownerNodeId = this.ctx.getOwnerNodeId();
        if (!ownerNodeId) throw new Error('No session loaded');

        const savedText = text;
        const savedAgentId = agentId;
        const sessionsBeforeSend = this.ctx.sessionManager.getSessions().map(s => s.id);

        this.ctx.chatInput.setLoading(true);
        this.ctx.historyView.scrollToBottom(true);

        try {
            let finalText = text || '';

            if (files.length > 0) {
                try {
                    const refs = await this.ctx.assetService.uploadFiles(ownerNodeId, files);
                    finalText += '\n\n' + refs.join('\n\n');
                } catch (uploadErr: any) {
                    Toast.error(uploadErr.message || 'Failed to upload files');
                    this.ctx.chatInput.restoreInput(savedText, savedAgentId);
                    this.ctx.chatInput.setLoading(false);
                    return;
                }
            }

            if (!finalText.trim()) {
                this.ctx.chatInput.setLoading(false);
                return;
            }

            await this.ctx.sessionManager.sendMessage(
                finalText.trim(), files, agentId || 'default', overrides
            );
        } catch (error: any) {
            this.rollbackFailedSend(sessionsBeforeSend);
            this.ctx.chatInput.restoreInput(savedText, savedAgentId);

            const classified = ErrorHandler.classifyError(error);
            Toast.error(classified.userMessage);
            if (classified.isAuthError) {
                this.ctx.historyView.renderError(error);
            }

            this.ctx.chatInput.setLoading(false);
        }
    }

    private rollbackFailedSend(sessionsBeforeSend: string[]): void {
        const sessionsAfterFail = this.ctx.sessionManager.getSessions().map(s => s.id);
        const ghostIds = sessionsAfterFail.filter(id => !sessionsBeforeSend.includes(id));

        if (ghostIds.length > 0) {
            this.ctx.historyView.removeMessages(ghostIds, false);
            for (const id of ghostIds) {
                try {
                    this.ctx.sessionManager.deleteMessage(id, { deleteAssociatedResponses: true });
                } catch (_) { /* silent */ }
            }
        }

        this.ctx.historyView.exitStreamingMode();
        this.ctx.historyView.clearErrors();
    }
}
