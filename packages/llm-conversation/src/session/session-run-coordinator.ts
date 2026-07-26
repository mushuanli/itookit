import type {
    ContextSnapshot,
    ProcessHost,
    Signal,
    FlowNodeDefinition,
} from '@itookit/common';
import { ulid } from '../persistence/ulid';
import type {
    ChatAttachment,
    ExecutionNode,
    ExecutionOverrides,
    ExecutionTask,
    ExecutorConfig,
    SessionGroup,
    SessionRuntime,
    SessionStatus,
    TaskInput,
} from '../core/types';
import { ConversationError, ConversationErrorCode } from '../core/errors';
import type { IChatEngine } from '../persistence/types';
import { FlowDefinitionStore } from '../persistence/flow-definition-store';
import { RoundLog } from '../persistence/round-log';
import { flowToDag } from '../flow/to-dag';
import { formatErrorMessage } from '../utils/error-formatter';
import { log } from '../utils/logger';
import { AgentResolver } from './agent-resolver';
import { AttachmentProcessor } from './attachment-processor';
import { ConversationRunCoordinator } from './conversation-run-coordinator';
import { SessionEventBus } from './session-event-bus';
import { SessionState } from './session-state';

export interface SessionRunCallbacks {
    onStatusChange(sessionId: string, status: SessionStatus): void;
    onUnread(sessionId: string): void;
    getBoundSessionId?(): string | null;
    getSessionContext(sessionId: string): {
        state: SessionState;
        runtime: SessionRuntime;
    } | null;
}

interface ExecutionSetup {
    config: ExecutorConfig;
    rootNode: ExecutionNode;
    roundId: string;
    contextFiles: ChatAttachment[];
}

export class SessionRunCoordinator {
    private readonly active = new Map<string, ExecutionTask>();
    private readonly logs = new Map<string, RoundLog>();
    private readonly runs: ConversationRunCoordinator;

    constructor(
        private readonly engine: IChatEngine,
        private readonly eventBus: SessionEventBus,
        private readonly agents: AgentResolver,
        private readonly attachments: AttachmentProcessor,
        private readonly callbacks: SessionRunCallbacks,
        processHost: ProcessHost,
    ) {
        this.runs = new ConversationRunCoordinator({
            engine,
            eventBus,
            processHost,
            loadArtifact: async () => null,
        });
    }

    async submit(input: TaskInput, runtime: SessionRuntime): Promise<string> {
        if (this.active.has(input.sessionId)) {
            throw new ConversationError(ConversationErrorCode.SESSION_BUSY, 'Session already has an active run');
        }
        const task = await this.createTask(input);
        this.active.set(input.sessionId, task);
        runtime.currentTaskId = task.id;
        this.callbacks.onStatusChange(input.sessionId, 'queued');
        void this.execute(task, runtime);
        return task.id;
    }

    respondToSignal(sessionId: string, signal: Signal): void {
        if (this.runs.signal(sessionId, signal)) return;
        log.warn('No waiting run for signal', { sessionId, signalType: signal.type });
    }

    abort(sessionId: string): void {
        const task = this.active.get(sessionId);
        if (!task) return;
        task.abortController.abort();
        this.runs.cancel(sessionId);
    }

    abortAll(): void {
        for (const task of this.active.values()) task.abortController.abort();
        this.runs.cancelAll();
        this.active.clear();
    }

    private async execute(task: ExecutionTask, runtime: SessionRuntime): Promise<void> {
        const context = this.callbacks.getSessionContext(task.sessionId);
        if (!context) return this.finishMissingContext(task, runtime);
        this.callbacks.onStatusChange(task.sessionId, 'running');
        let roundLog: RoundLog | undefined;
        try {
            roundLog = await this.getLog(task);
            const setup = await this.setup(task, context.state);
            await this.executeRequest(task, context.state, roundLog, setup);
            this.callbacks.onStatusChange(task.sessionId, 'completed');
            this.callbacks.onUnread(task.sessionId);
        } catch (error) {
            this.handleError(error, task, runtime, context.state);
        } finally {
            this.active.delete(task.sessionId);
            runtime.currentTaskId = undefined;
        }
    }

    private async executeRequest(
        task: ExecutionTask,
        state: SessionState,
        roundLog: RoundLog,
        setup: ExecutionSetup,
    ): Promise<void> {
        const execution = {
            task,
            state,
            config: setup.config,
            log: roundLog,
            rootNodeId: setup.rootNode.id,
            roundId: setup.roundId,
            contextFiles: setup.contextFiles,
            finalize: async () => {},
        };
        const flow = task.input.sendIntent?.execution;
        if (flow?.kind !== 'flow') return this.runs.executeDirect(execution);
        const revision = await new FlowDefinitionStore(this.engine, task.nodeId)
            .loadRevision(flow.flowId, flow.revision);
        if (!revision) throw new Error(`Flow revision not found: ${flow.flowId}`);
        return this.runs.executeDag(execution, snapshot =>
            flowToDag(revision, node => bindNode(node, snapshot, task, setup)),
        );
    }

    private async createTask(input: TaskInput): Promise<ExecutionTask> {
        const roundLog = this.logs.get(input.sessionId)
            ?? new RoundLog(this.engine, input.nodeId, input.sessionId);
        this.logs.set(input.sessionId, roundLog);
        const manifest = await roundLog.loadManifest();
        const agent = await this.agents.resolveForChat(input.agentId);
        if (!agent.agentVersion) {
            throw new Error(`Agent version is required: ${agent.id}`);
        }
        const branchRef = manifest.currentBranch || 'main';
        return {
            id: `run-request-${ulid()}`,
            sessionId: input.sessionId,
            nodeId: input.nodeId,
            input,
            priority: 0,
            createdAt: Date.now(),
            abortController: new AbortController(),
            frozen: {
                branchRef,
                branchHead: manifest.branches[branchRef] ?? null,
                contextProfile: manifest.branchMeta[branchRef]?.contextProfile,
                agentVersion: agent.agentVersion,
            },
        };
    }

    private async setup(
        task: ExecutionTask,
        state: SessionState,
    ): Promise<ExecutionSetup> {
        const files = await this.attachments.resolveAttachments(
            task.sessionId,
            task.input.text,
            task.input.files,
        );
        const roundId = resolveRoundId(task.input);
        const userNodeId = task.input.skipUserMessage
            ? task.input.parentUserNodeId
            : this.createUserMessage(task, state, files, roundId);
        const config = await this.resolveConfig(task.input);
        const rootNode = this.createAssistantNode(task, state, config, roundId, userNodeId);
        return { config, rootNode, roundId, contextFiles: files };
    }

    private createUserMessage(
        task: ExecutionTask,
        state: SessionState,
        files: ChatAttachment[],
        roundId: string,
    ): string {
        const parentId = assistantParent(state);
        const group = state.addPendingUserMessage(
            task.input.text,
            files,
            roundId,
            task.input.origin,
            task.input.historyPolicy,
        );
        if (this.callbacks.getBoundSessionId?.() === task.sessionId) {
            this.eventBus.emitSession(task.sessionId, {
                type: 'message:appended',
                payload: { sessionGroup: group, parentId },
            });
        }
        return group.id;
    }

    private createAssistantNode(
        task: ExecutionTask,
        state: SessionState,
        config: ExecutorConfig,
        roundId: string,
        parentId?: string,
    ): ExecutionNode {
        const root = executionNode(roundId, config);
        const group = assistantGroup(task, root, roundId);
        state.addPendingAssistantMessage(group);
        if (this.callbacks.getBoundSessionId?.() === task.sessionId) {
            this.eventBus.emitSession(task.sessionId, {
                type: 'message:appended',
                payload: {
                    sessionGroup: group,
                    isExecutionRoot: true,
                    parentId,
                },
            });
        }
        return root;
    }

    private async resolveConfig(input: TaskInput): Promise<ExecutorConfig> {
        let config = await this.agents.resolve(input.agentId);
        if (!input.overrides) return config;
        config = applyOverrides(config, input.overrides);
        if (input.overrides.connectionId || input.overrides.modelTier) {
            config = await this.agents.reResolveModel(config, {
                connectionId: input.overrides.connectionId,
                modelTier: input.overrides.modelTier,
            });
        }
        return config;
    }

    private async getLog(task: ExecutionTask): Promise<RoundLog> {
        const cached = this.logs.get(task.sessionId);
        if (cached) return cached;
        const created = new RoundLog(this.engine, task.nodeId, task.sessionId);
        this.logs.set(task.sessionId, created);
        return created;
    }

    private handleError(
        error: unknown,
        task: ExecutionTask,
        runtime: SessionRuntime,
        state: SessionState,
    ): void {
        const aborted = task.abortController.signal.aborted
            || (error instanceof Error && error.name === 'AbortError');
        const status = aborted ? 'aborted' as const : 'failed' as const;
        runtime.error = error instanceof Error ? error : new Error(String(error));
        this.callbacks.onStatusChange(task.sessionId, status);
        const message = formatErrorMessage(error);
        projectError(this.eventBus, task.sessionId, state, status, message);
    }

    private finishMissingContext(task: ExecutionTask, runtime: SessionRuntime): void {
        this.active.delete(task.sessionId);
        runtime.currentTaskId = undefined;
        log.error('Session context not found', { sessionId: task.sessionId });
    }
}

function bindNode(
    node: FlowNodeDefinition,
    snapshot: ContextSnapshot,
    task: ExecutionTask,
    setup: ExecutionSetup,
) {
    if (node.plugin !== 'builtin.agent') {
        return { inputs: { ...node.inputs, prompt: task.input.text } };
    }
    return {
        config: {
            ...record(node.config),
            prompt: task.input.text,
            messages: snapshot.canonicalMessages,
            sessionId: task.sessionId,
            roundId: `${setup.roundId}:${node.id}`,
            connectionId: setup.config.connectionId ?? 'default',
            model: setup.config.model,
            temperature: setup.config.temperature,
            maxTokens: setup.config.constraints?.maxTokens,
            thinking: setup.config.enableThinking,
            reasoningEffort: setup.config.reasoningEffort,
            toolIds: setup.config.capabilityPolicy?.toolIds ?? [],
        } as never,
        capabilities: setup.config.capabilityPolicy?.toolIds ?? [],
    };
}

function executionNode(id: string, config: ExecutorConfig): ExecutionNode {
    return {
        id: `round-${id}-assistant`,
        name: config.name || config.id,
        executorType: config.type || 'agent',
        executorId: config.id,
        status: 'running',
        startTime: Date.now(),
        data: {
            output: '',
            thought: '',
            metaInfo: { agentId: config.id, agentIcon: config.icon },
        },
        children: [],
    };
}

function assistantGroup(
    task: ExecutionTask,
    root: ExecutionNode,
    roundId: string,
): SessionGroup {
    return {
        id: root.id,
        persistedNodeId: roundId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        executionRoot: root,
        siblingIndex: task.input.branchInfo?.siblingIndex,
        siblingCount: task.input.branchInfo?.siblingCount,
        origin: task.input.origin ?? 'user',
        historyPolicy: task.input.historyPolicy ?? 'include',
    };
}

function assistantParent(state: SessionState): string | undefined {
    const previous = state.getLastSession();
    return previous?.role === 'assistant' ? previous.id : undefined;
}

function resolveRoundId(input: TaskInput): string {
    return input.roundTarget?.mode === 'update-existing'
        ? input.roundTarget.targetRoundId
        : input.roundTarget?.roundId ?? ulid();
}

function applyOverrides(
    config: ExecutorConfig,
    overrides: ExecutionOverrides,
): ExecutorConfig {
    const updated = { ...config };
    if (overrides.connectionId) updated.connectionId = overrides.connectionId;
    if (overrides.temperature !== undefined) updated.temperature = overrides.temperature;
    if (overrides.streamMode !== undefined) updated.stream = overrides.streamMode;
    if (overrides.reasoningEffort) updated.reasoningEffort = overrides.reasoningEffort;
    if (overrides.thinkingEnabled !== undefined) updated.enableThinking = overrides.thinkingEnabled;
    if (overrides.systemPromptAppend) {
        updated.systemPrompt = [updated.systemPrompt, overrides.systemPromptAppend]
            .filter(Boolean).join('\n\n');
    }
    return updated;
}

function projectError(
    eventBus: SessionEventBus,
    sessionId: string,
    state: SessionState,
    status: 'aborted' | 'failed',
    message: string,
): void {
    const root = state.getLastSession()?.executionRoot;
    if (root) {
        state.updateNodeStatus(root.id, status);
        state.updateNodeError(root.id, message);
        eventBus.emitSession(sessionId, {
            type: 'message:status',
            payload: { messageId: root.id, status, result: message },
        });
    }
    eventBus.emitSession(sessionId, {
        type: 'error',
        error: { message },
    });
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}
