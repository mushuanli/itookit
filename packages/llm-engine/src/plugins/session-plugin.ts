// session-plugin — registers core session operation commands.
//
// Maps SessionManager methods to ICommandBus commands so UI can call
// commands.execute('session.send', { text }) instead of sessionManager.sendMessage().

import type { ILLMPlugin, ExtensionContext } from '@itookit/common';
import type { SessionManager } from '../session/session-manager';

export function createSessionPlugin(sessionManager: SessionManager): ILLMPlugin {
    return {
        name: 'session',
        activate(ctx: ExtensionContext): void {
            const sm = sessionManager;

            ctx.commands.register('session.bind', async (args) => {
                const { nodeId, sessionId } = args as { nodeId: string; sessionId: string };
                return sm.bindSession(nodeId, sessionId);
            });
            ctx.commands.register('session.unbind', async () => sm.unbindSession());
            ctx.commands.register('session.update-node', async (args) => {
                const { newNodeId } = args as { newNodeId: string };
                return sm.updateBoundNodeId(newNodeId);
            });

            ctx.commands.register('session.get-snapshot', async () => sm.getSnapshot());
            ctx.commands.register('session.get-sessions', async () => sm.getSessions());
            ctx.commands.register('session.get-current-id', async () => sm.getCurrentSessionId());
            ctx.commands.register('session.get-current-node', async () => sm.getCurrentNodeId());
            ctx.commands.register('session.get-status', async () => sm.getStatus());
            ctx.commands.register('session.is-generating', async () => sm.isGenerating());
            ctx.commands.register('session.has-unsaved', async () => sm.hasUnsavedChanges());
            ctx.commands.register('session.pool-status', async () => sm.getPoolStatus());
            ctx.commands.register('session.get-all', async () => sm.getAllSessions());
            ctx.commands.register('session.get-runtime', async (args) => {
                const { sessionId } = args as { sessionId: string };
                return sm.getSessionRuntime(sessionId);
            });

            ctx.commands.register('session.can-regenerate', async (args) => {
                const { messageId } = args as { messageId: string };
                return sm.canRegenerate(messageId);
            });
            ctx.commands.register('session.can-delete', async (args) => {
                const { messageId } = args as { messageId: string };
                return sm.canDeleteMessage(messageId);
            });
            ctx.commands.register('session.can-edit', async (args) => {
                const { messageId } = args as { messageId: string };
                return sm.canEdit(messageId);
            });

            ctx.commands.register('session.send', async (args) => {
                const { text, files, agentId, overrides, origin, historyPolicy, sendIntent } = args as {
                    text: string;
                    files?: unknown[];
                    agentId?: string;
                    overrides?: unknown;
                    origin?: unknown;
                    historyPolicy?: unknown;
                    sendIntent?: unknown;
                };
                return sm.sendMessage(text, files as any, agentId ?? '', overrides as any, origin as any, historyPolicy as any, sendIntent as any);
            });
            ctx.commands.register('session.abort', async () => sm.abort());
            ctx.commands.register('session.context.set', async (args) => {
                const { roundIds, mode, scope } = args as {
                    roundIds: string[];
                    mode: 'include' | 'exclude';
                    scope?: 'node' | 'subtree';
                };
                return sm.setContextMode(roundIds, mode, scope);
            });
            ctx.commands.register('session.context.get', async (args) => {
                const { roundIds } = args as { roundIds: string[] };
                return sm.getContextModes(roundIds);
            });

            ctx.commands.register('session.regenerate', async (args) => {
                const { assistantId, options } = args as { assistantId: string; options?: unknown };
                return sm.regenerate(assistantId, options as any);
            });
            ctx.commands.register('session.regenerate-from-user', async (args) => {
                const { userMessageId, options } = args as { userMessageId: string; options?: unknown };
                return sm.regenerateFromUser(userMessageId, options as any);
            });

            ctx.commands.register('session.delete-message', async (args) => {
                const { messageId, options } = args as { messageId: string; options?: unknown };
                return sm.deleteMessage(messageId, options as any);
            });
            ctx.commands.register('session.delete-messages', async (args) => {
                const { messageIds, options } = args as { messageIds: string[]; options?: unknown };
                return sm.deleteMessages(messageIds, options as any);
            });
            ctx.commands.register('session.update-draft', async (args) => {
                const { messageId, newContent } = args as { messageId: string; newContent: string };
                return sm.updateDraft(messageId, newContent);
            });
            ctx.commands.register('session.commit-edit', async (args) => {
                const { messageId, newContent, autoRerun } = args as { messageId: string; newContent: string; autoRerun?: boolean };
                return sm.commitEdit(messageId, newContent, autoRerun);
            });
            ctx.commands.register('session.switch-sibling', async (args) => {
                const { messageId, siblingIndex } = args as { messageId: string; siblingIndex: number };
                return sm.switchToSibling(messageId, siblingIndex);
            });
            ctx.commands.register('session.get-siblings', async (args) => {
                const { messageId } = args as { messageId: string };
                return sm.getSiblings(messageId);
            });

            ctx.commands.register('session.get-settings', async () => sm.getSessionSettings());
            ctx.commands.register('session.save-settings', async (args) => {
                return sm.saveSessionSettings(args as any);
            });

            ctx.commands.register('session.get-agents', async () => sm.getAvailableAgents());
            ctx.commands.register('session.get-models', async (args) => {
                const { agentId } = args as { agentId: string };
                return sm.getModelsForAgent(agentId);
            });

            ctx.commands.register('session.export', async () => sm.exportToMarkdown());
            ctx.commands.register('session.set-concurrency', async (args) => {
                const { value } = args as { value: number };
                return sm.setMaxConcurrent(value);
            });
        },
    };
}
