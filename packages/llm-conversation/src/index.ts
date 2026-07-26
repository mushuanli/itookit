export * from './core/types';
export * from './core/errors';
export { CONVERSATION_DEFAULTS } from './core/constants';
export { CommandBus } from './core/command-bus';
export { ExtensionRegistry } from './core/extension-registry';

export { createSessionPlugin } from './plugins/session-plugin';
export { createVcsPlugin } from './plugins/vcs-plugin';
export { createHistoryPlugin } from './plugins/history-plugin';

export {
    SessionManager,
    createSessionManager,
    getSessionManager,
    resetSessionManager,
} from './session/session-manager';
export { SessionRegistry, type BoundContext } from './session/session-registry';
export { RoundOperations } from './session/round-operations';
export { BranchService } from './session/branch-service';
export { SessionState, type HistoryMessage } from './session/session-state';
export { SessionEventBus } from './session/session-event-bus';
export { AgentResolver, type AgentInfo, type ModelInfo } from './session/agent-resolver';
export { AttachmentProcessor } from './session/attachment-processor';

export { ChatEngine } from './persistence/chat-engine';
export { RoundLog, roundToProjection, hasEffectiveAssistant } from './persistence/round-log';
export { RoundGraphService, RoundGraphError } from './persistence/round-graph-service';
export {
    FlowDefinitionStore,
    FlowDraftVersionConflictError,
} from './persistence/flow-definition-store';
export * from './flow';
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

export { chatFileParser } from './utils/parsers';
export { formatErrorMessage } from './utils/error-formatter';
import type { DagPluginCatalog, ProcessHost } from '@itookit/common';
import { AgentProgram, ChatProgram } from '@itookit/llm-engine';
import type { IAgentConfigService } from './services/agent-service';
import type { IChatEngine } from './persistence/types';
import { SessionManager, createSessionManager } from './session/session-manager';
import { initializePromptHistory } from './services/prompt-history-service';
import { CommandBus } from './core/command-bus';
import { ExtensionRegistry } from './core/extension-registry';
import { createSessionPlugin } from './plugins/session-plugin';
import { createVcsPlugin } from './plugins/vcs-plugin';
import { createHistoryPlugin } from './plugins/history-plugin';
import { FlowDefinitionStore } from './persistence/flow-definition-store';
import { DagCommandService } from './flow/commands';

export interface ConversationSystemOptions {
    agentService: IAgentConfigService;
    sessionEngine: IChatEngine;
    processHost: ProcessHost;
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
    registerPrograms(options.processHost);
    const sessionManager = createSessionManager(
        options.sessionEngine,
        options.agentService,
        { processHost: options.processHost },
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

function registerPrograms(processHost: ProcessHost): void {
    if (!processHost.hasProgram('llm.chat')) {
        processHost.registerProgram(new ChatProgram());
    }
    if (!processHost.hasProgram('llm.agent')) {
        processHost.registerProgram(new AgentProgram());
    }
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
        options.sessionEngine,
        'llm-flows',
        options.dagPlugins,
    );
    const dag = new DagCommandService({
        flowStore,
        controlPlane: options.processHost,
        plugins: options.dagPlugins,
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
