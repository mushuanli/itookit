// @file: llm-ui/commands/SendMessageCommand.ts


import { SessionCommand, type SessionGroup, type SessionOrigin, type HistoryPolicy } from '@itookit/llm-session';
import { Command } from './Command';
import { Toast } from '@itookit/ui-common';
import { ErrorHandler } from '../utils/errorHandler';
import type { ChatOverrides } from '../domain/types';

import { createAgentSendIntent } from '@itookit/common';

export interface SendMessageParams {
    text: string;
    files: File[];
    agentId?: string;
    overrides?: ChatOverrides;
    origin?: SessionOrigin;
    historyPolicy?: HistoryPolicy;
}

export class SendMessageCommand extends Command<SendMessageParams> {
    protected name = 'Send Message';

    protected async execute({ text, files, agentId, overrides, origin, historyPolicy }: SendMessageParams): Promise<void> {
        const ownerNodeId = this.ctx.getOwnerNodeId();
        if (!ownerNodeId) throw new Error('No session loaded');

        const savedText = text;
        const savedAgentId = agentId;
        const sessionsBeforeSend = (await this.ctx.commands.execute<SessionGroup[]>(SessionCommand.GetSessions)).map(s => s.id);

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

            await this.ctx.commands.execute(SessionCommand.Send, {
                text: finalText.trim(),
                files,
                agentId: agentId || 'default',
                overrides,
                origin,
                historyPolicy,
                sendIntent: {
                    ...createAgentSendIntent(agentId || 'default'),
                    branch: {
                        mode: overrides?.branchMode ?? 'continue',
                        baseRoundId: overrides?.baseRoundId,
                        newBranchName: overrides?.newBranchName,
                    },
                    retention: { mode: overrides?.retentionMode ?? 'persistent' },
                    execution: overrides?.flowId
                        ? {
                            kind: 'flow',
                            flowId: overrides.flowId,
                            revision: overrides.flowRevision,
                            parameters: overrides.flowParameters,
                        }
                        : { kind: 'agent', agentId: agentId || 'default' },
                },
            });
        } catch (error: any) {
            await this.rollbackFailedSend(sessionsBeforeSend);
            this.ctx.chatInput.restoreInput(savedText, savedAgentId);

            const classified = ErrorHandler.classifyError(error);
            Toast.error(classified.userMessage);
            if (classified.isAuthError) {
                this.ctx.historyView.renderError(error);
            }

            this.ctx.chatInput.setLoading(false);
        }
    }

    private async rollbackFailedSend(sessionsBeforeSend: string[]): Promise<void> {
        const sessionsAfterFail = (await this.ctx.commands.execute<SessionGroup[]>(SessionCommand.GetSessions)).map(s => s.id);
        const ghostIds = sessionsAfterFail.filter(id => !sessionsBeforeSend.includes(id));

        if (ghostIds.length > 0) {
            this.ctx.historyView.removeMessages(ghostIds, false);
            for (const id of ghostIds) {
                try {
                    this.ctx.commands.execute(SessionCommand.DeleteMessage, {
                        messageId: id,
                        options: { deleteAssociatedResponses: true },
                    });
                } catch (_) { /* silent */ }
            }
        }
    }
}
