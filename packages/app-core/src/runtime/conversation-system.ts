import { SessionMemoryProvider, initializeConversationSystem, type CommandBus, type FlowEngine, type SessionManager, type SessionRepository, type VFSAgentService } from '@itookit/llm-session';
import { resolveSessionSkillContext } from '@itookit/kernel-adapters';
import type { IVFSManager } from '@itookit/vfs-core';
import { resetSessionManager } from '@itookit/llm-session';
import type { HeadlessKernelRuntime } from './create-kernel-runtime';

export interface ConversationSystemOptions {
    vfs: IVFSManager;
    agentService: VFSAgentService;
    sessionRepository: SessionRepository;
    flowEngine: FlowEngine;
    kernel: HeadlessKernelRuntime;

}

/**
 * Assemble the conversation layer on top of a recovered Kernel: prompt history lives in
 * the VFS, the Kernel owns session context and tools, and the host only supplies the ports.
 * `resolveTools` narrows the advertised tools to the node's grants and marks external ones.
 */
export async function createConversationSystem(
    options: ConversationSystemOptions,
): Promise<{ sessionManager: SessionManager; commandBus: CommandBus }> {
    const { vfs, agentService, sessionRepository, flowEngine, kernel } = options;
    return initializeConversationSystem({
        agentService,
        sessionEngine: sessionRepository,
        promptHistoryFiles: await vfs.openFileSystem('/home/admin/.config/mindos/prompt-history'),
        kernel: kernel.kernel,
        flowStore: flowEngine,
        dagPlugins: kernel.dagPlugins,
        retrieveMemory: new SessionMemoryProvider(kernel.kernel).retrieve,
        resolveSessionContext: (sessionId, userMessage) => resolveSessionSkillContext(kernel.kernel, kernel.sessions, sessionId, userMessage),
        resolveTools: async (sessionId, allowedIds) => {
            const tools = (await kernel.sessions.get(sessionId)).toolService;
            const allowed = new Set(allowedIds);
            return {
                definitions: tools.getToolDefinitions().filter(definition => {
                    const name = definition.function?.name ?? definition.name;
                    return Boolean(name && allowed.has(name));
                }),
                externalIds: allowedIds.filter(id => tools.getToolMeta(id)?.sideEffect === 'external'),
            };
        },
    });
}

/** The conversation layer is process-wide; release it during host shutdown. */
export function disposeConversationSystem(): void {
    resetSessionManager();
}
