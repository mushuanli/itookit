// session-plugin — registers core session operation commands.
//
// Maps SessionManager methods to ICommandBus commands so UI can call
// commands.execute(SessionCommand.Send, { text }) instead of sessionManager.sendMessage().

import type { ILLMPlugin, ExtensionContext } from '@itookit/common';
import type { SessionManager } from '../session/session-manager';

/** Session-scoped command names owned by the session plugin. */
export const SessionCommand = {
    Bind: 'session.bind',
    Unbind: 'session.unbind',
    CreateFromFlow: 'session.create-from-flow',
    UpdateNode: 'session.update-node',
    GetSnapshot: 'session.get-snapshot',
    GetSessions: 'session.get-sessions',
    GetCurrentId: 'session.get-current-id',
    GetCurrentNode: 'session.get-current-node',
    GetStatus: 'session.get-status',
    IsGenerating: 'session.is-generating',
    HasUnsaved: 'session.has-unsaved',
    GetAll: 'session.get-all',
    GetRuntime: 'session.get-runtime',
    CanRegenerate: 'session.can-regenerate',
    CanDelete: 'session.can-delete',
    CanEdit: 'session.can-edit',
    Send: 'session.send',
    Abort: 'session.abort',
    ContextSet: 'session.context.set',
    ContextGet: 'session.context.get',
    ContextSnapshotGet: 'session.context.snapshot.get',
    ContextPreview: 'session.context.preview',
    Regenerate: 'session.regenerate',
    RegenerateFromUser: 'session.regenerate-from-user',
    DeleteMessage: 'session.delete-message',
    DeleteMessages: 'session.delete-messages',
    UpdateDraft: 'session.update-draft',
    CommitEdit: 'session.commit-edit',
    SwitchSibling: 'session.switch-sibling',
    GetSiblings: 'session.get-siblings',
    GetSettings: 'session.get-settings',
    SaveSettings: 'session.save-settings',
    GetAgents: 'session.get-agents',
    GetModels: 'session.get-models',
    Export: 'session.export',
} as const;

export function createSessionPlugin(sessionManager: SessionManager): ILLMPlugin {
    return {
        name: 'session',
        activate(ctx: ExtensionContext): void {
            const sm = sessionManager;

            ctx.commands.register(SessionCommand.Bind, async (args) => {
                const { nodeId, sessionId } = args as { nodeId: string; sessionId: string };
                return sm.bindSession(nodeId, sessionId);
            });
            ctx.commands.register(SessionCommand.Unbind, async () => sm.unbindSession());
            ctx.commands.register(SessionCommand.CreateFromFlow, async (args) => {
                const { flowId, revision, parameters, title } = args as {
                    flowId: string;
                    revision: number;
                    parameters?: Record<string, unknown>;
                    title?: string;
                };
                return sm.createSessionFromFlow(
                    flowId,
                    revision,
                    parameters as Record<string, import('@itookit/common').JsonValue> | undefined,
                    title ?? 'Workflow',
                );
            });
            ctx.commands.register(SessionCommand.UpdateNode, async (args) => {
                const { newNodeId } = args as { newNodeId: string };
                return sm.updateBoundNodeId(newNodeId);
            });

            ctx.commands.register(SessionCommand.GetSnapshot, async () => sm.getSnapshot());
            ctx.commands.register(SessionCommand.GetSessions, async () => sm.getSessions());
            ctx.commands.register(SessionCommand.GetCurrentId, async () => sm.getCurrentSessionId());
            ctx.commands.register(SessionCommand.GetCurrentNode, async () => sm.getCurrentNodeId());
            ctx.commands.register(SessionCommand.GetStatus, async () => sm.getStatus());
            ctx.commands.register(SessionCommand.IsGenerating, async () => sm.isGenerating());
            ctx.commands.register(SessionCommand.HasUnsaved, async () => sm.hasUnsavedChanges());
            ctx.commands.register(SessionCommand.GetAll, async () => sm.getAllSessions());
            ctx.commands.register(SessionCommand.GetRuntime, async (args) => {
                const { sessionId } = args as { sessionId: string };
                return sm.getSessionRuntime(sessionId);
            });

            ctx.commands.register(SessionCommand.CanRegenerate, async (args) => {
                const { messageId } = args as { messageId: string };
                return sm.canRegenerate(messageId);
            });
            ctx.commands.register(SessionCommand.CanDelete, async (args) => {
                const { messageId } = args as { messageId: string };
                return sm.canDeleteMessage(messageId);
            });
            ctx.commands.register(SessionCommand.CanEdit, async (args) => {
                const { messageId } = args as { messageId: string };
                return sm.canEdit(messageId);
            });

            ctx.commands.register(SessionCommand.Send, async (args) => {
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
            ctx.commands.register(SessionCommand.Abort, async () => sm.abort());
            ctx.commands.register(SessionCommand.ContextSet, async (args) => {
                const { roundIds, mode, scope } = args as {
                    roundIds: string[];
                    mode: 'include' | 'exclude';
                    scope?: 'node' | 'subtree';
                };
                return sm.setContextMode(roundIds, mode, scope);
            });
            ctx.commands.register(SessionCommand.ContextGet, async (args) => {
                const { roundIds } = args as { roundIds: string[] };
                return sm.getContextModes(roundIds);
            });
            ctx.commands.register(SessionCommand.ContextSnapshotGet, async (args) => {
                const { snapshotId } = args as { snapshotId: string };
                return sm.getContextSnapshot(snapshotId);
            });
            ctx.commands.register(SessionCommand.ContextPreview, async (args) => {
                const { agentId, pendingText } = args as { agentId: string; pendingText?: string };
                return sm.previewContext(agentId, pendingText);
            });
            ctx.commands.register(SessionCommand.Regenerate, async (args) => {
                const { assistantId, options } = args as { assistantId: string; options?: unknown };
                return sm.regenerate(assistantId, options as any);
            });
            ctx.commands.register(SessionCommand.RegenerateFromUser, async (args) => {
                const { userMessageId, options } = args as { userMessageId: string; options?: unknown };
                return sm.regenerateFromUser(userMessageId, options as any);
            });

            ctx.commands.register(SessionCommand.DeleteMessage, async (args) => {
                const { messageId, options } = args as { messageId: string; options?: unknown };
                return sm.deleteMessage(messageId, options as any);
            });
            ctx.commands.register(SessionCommand.DeleteMessages, async (args) => {
                const { messageIds, options } = args as { messageIds: string[]; options?: unknown };
                return sm.deleteMessages(messageIds, options as any);
            });
            ctx.commands.register(SessionCommand.UpdateDraft, async (args) => {
                const { messageId, newContent } = args as { messageId: string; newContent: string };
                return sm.updateDraft(messageId, newContent);
            });
            ctx.commands.register(SessionCommand.CommitEdit, async (args) => {
                const { messageId, newContent, autoRerun } = args as { messageId: string; newContent: string; autoRerun?: boolean };
                return sm.commitEdit(messageId, newContent, autoRerun);
            });
            ctx.commands.register(SessionCommand.SwitchSibling, async (args) => {
                const { messageId, siblingIndex } = args as { messageId: string; siblingIndex: number };
                return sm.switchToSibling(messageId, siblingIndex);
            });
            ctx.commands.register(SessionCommand.GetSiblings, async (args) => {
                const { messageId } = args as { messageId: string };
                return sm.getSiblings(messageId);
            });

            ctx.commands.register(SessionCommand.GetSettings, async () => sm.getSessionSettings());
            ctx.commands.register(SessionCommand.SaveSettings, async (args) => {
                return sm.saveSessionSettings(args as any);
            });

            ctx.commands.register(SessionCommand.GetAgents, async () => sm.getAvailableAgents());
            ctx.commands.register(SessionCommand.GetModels, async (args) => {
                const { agentId } = args as { agentId: string };
                return sm.getModelsForAgent(agentId);
            });

            ctx.commands.register(SessionCommand.Export, async () => sm.exportToMarkdown());
        },
    };
}
