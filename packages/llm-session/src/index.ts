export * from './core/types';
export * from './core/errors';
export { CONVERSATION_DEFAULTS } from './core/constants';
export { CommandBus } from './core/command-bus';
export { ExtensionRegistry } from './core/extension-registry';

export { createSessionPlugin, SessionCommand } from './plugins/session-plugin';
export { createVcsPlugin } from './plugins/vcs-plugin';
export { createHistoryPlugin } from './plugins/history-plugin';

export {
    SessionManager,
    createSessionManager,
    getSessionManager,
    resetSessionManager,
} from './session/session-manager';
export type { SessionQuery } from './session/session-query';
export { SessionRegistry, type BoundContext } from './session/session-registry';
export { RoundOperations } from './session/round-operations';
export { BranchService } from './session/branch-service';
export { SessionState, type HistoryMessage } from './session/session-state';
export { SessionEventBus } from './session/session-event-bus';
export { AgentResolver, type AgentInfo, type ModelInfo } from './session/agent-resolver';
export { AttachmentProcessor } from './session/attachment-processor';

export { ChatEngine } from './persistence/chat-engine';
export { FlowEngine, FLOW_MODULE_NAME } from './persistence/flow-engine';
export { seedDefaultFlows, essayReviewDraft, ESSAY_REVIEW_FLOW_ID } from './persistence/default-flows';
export { RoundLog, roundToProjection, hasEffectiveAssistant } from './persistence/round-log';
export { RoundGraphService, RoundGraphError } from './persistence/round-graph-service';
export * from '@itookit/llm-flow';
export { FlowDefinitionStore, FlowDraftVersionConflictError } from '@itookit/llm-flow';
export type {
    RoundManifest,
    RoundProjection,
    PersistedRound,
    BranchMeta,
} from './persistence/round-types';
export type { RoundLogEvent, RoundChangeSet } from './persistence/round-events';
export type {
    IChatEngine,
    ConversationManifest,
    ConversationUIState,
    BranchTreeNode,
} from './persistence/types';

export {
    getPromptHistory,
    PromptHistoryService,
    type PromptHistoryEntry,
    type HistoryQueryOptions,
} from './services/prompt-history-service';
export type {
    IAgentConfigService,
    IAgentManagementService,
    IConnectionService,
    MCPServer,
} from './services/agent-service';
export { VFSAgentService } from './services/vfs-agent-service';
export type {
    IPrivilegedCommandService,
    PlanCommandRequest,
    ExecCommandRequest,
} from './services/privileged-command';

export { chatFileParser } from './utils/parsers';
export {
    CHAT_HARNESS_STORAGE_KIND,
    ChatKernelStorageResolver,
    chatKernelStorage,
} from './persistence/chat-kernel-storage';
export { DurableConversationProjection } from './persistence/durable-conversation-projection';
export { formatErrorMessage } from './utils/error-formatter';
import type { DagPluginCatalog, ToolDefinition } from '@itookit/common';
import type { Kernel } from '@itookit/durable-kernel';
import { DurableAgentProgram, DurableChatProgram, DurablePlanProgram } from '@itookit/llm-tasks';
import type { IAgentConfigService } from './services/agent-service';
import type { IChatEngine } from './persistence/types';
import { SessionManager, createSessionManager } from './session/session-manager';
import { initializePromptHistory } from './services/prompt-history-service';
import { CommandBus } from './core/command-bus';
import { ExtensionRegistry } from './core/extension-registry';
import { createSessionPlugin } from './plugins/session-plugin';
import { createVcsPlugin } from './plugins/vcs-plugin';
import { createHistoryPlugin } from './plugins/history-plugin';
import { FlowDefinitionStore, type FlowStore } from '@itookit/llm-flow';
import { DagCommandService } from '@itookit/llm-flow';
import { FlowAggregateProgram, FlowHumanProgram, FlowValueProgram } from '@itookit/llm-flow';

export interface ConversationSystemOptions {
    agentService: IAgentConfigService;
    sessionEngine: IChatEngine;
    kernel: Kernel;
    /** Standalone workflow storage (flows VFS module). */
    flowStore: FlowStore;
    resolveTools?: (sessionId: string, allowedIds: string[]) => Promise<{
        definitions: ToolDefinition[];
        externalIds: string[];
    }>;
    dagPlugins: DagPluginCatalog;
}

export interface ConversationSystem {
    sessionManager: SessionManager;
    commandBus: CommandBus;
    dag: DagCommandService;
}

export async function initializeConversationSystem(
    options: ConversationSystemOptions,
): Promise<ConversationSystem> {
    await initializeServices(options);
    registerPrograms(options.kernel);
    const sessionManager = createSessionManager(
        options.sessionEngine,
        options.agentService,
        {
            kernel: options.kernel,
            dagPlugins: options.dagPlugins,
            flowStore: options.flowStore,
            resolveTools: options.resolveTools,
        },
    );
    return createControlPlane(options, sessionManager);
}

async function initializeServices(options: ConversationSystemOptions): Promise<void> {
    await options.agentService.init();
    await options.sessionEngine.init();
    await initializePromptHistory(options.sessionEngine.vfs).catch(error => {
        console.warn('[Conversation] Prompt history initialization failed:', error);
    });
}

function registerPrograms(kernel: Kernel): void {
    if (!kernel.programs.has('llm.chat', '1')) kernel.registerProgram(new DurableChatProgram());
    if (!kernel.programs.has('llm.agent', '1')) kernel.registerProgram(new DurableAgentProgram());
    if (!kernel.programs.has('llm.plan', '1')) kernel.registerProgram(new DurablePlanProgram());
    if (!kernel.programs.has('flow.value', '1')) kernel.registerProgram(new FlowValueProgram());
    if (!kernel.programs.has('flow.human', '1')) kernel.registerProgram(new FlowHumanProgram());
    if (!kernel.programs.has('flow.aggregate', '1')) kernel.registerProgram(new FlowAggregateProgram());
}

function createControlPlane(
    options: ConversationSystemOptions,
    sessionManager: SessionManager,
): ConversationSystem {
    const commandBus = new CommandBus();
    const dag = createDagCommands(options, commandBus);
    activateConversationPlugins(sessionManager, commandBus);
    return { sessionManager, commandBus, dag };
}

function createDagCommands(
    options: ConversationSystemOptions,
    commandBus: CommandBus,
): DagCommandService {
    const flowStore = new FlowDefinitionStore(
        options.flowStore,
        options.dagPlugins,
    );
    const dag = new DagCommandService({
        flowStore,
        kernel: options.kernel,
        plugins: options.dagPlugins,
        resolveTools: options.resolveTools,
    });
    dag.register(commandBus);
    return dag;
}

function activateConversationPlugins(
    sessionManager: SessionManager,
    commandBus: CommandBus,
): void {
    const extensions = new ExtensionRegistry();
    extensions.register(createSessionPlugin(sessionManager));
    extensions.register(createVcsPlugin(sessionManager));
    extensions.register(createHistoryPlugin(sessionManager));
    extensions.activate({ commands: commandBus });
}
