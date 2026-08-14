import type {
    AgentEvent,
    Artifact,
    ChatMessage,
    ContextSnapshot,
    DagPluginCatalog,
    DagRunSpec,
    Signal,
    ToolDefinition,
} from '@itookit/common';
import {
    bindCapabilities,
    type CapabilityBinding,
    type EventEnvelope,
    type Harness,
    type JsonValue,
    type TaskHandle,
    type TaskSpec,
} from '@itookit/harness';
import type {
    ChatAttachment,
    ExecutionTask,
    ExecutorConfig,
} from '../core/types';
import {
    buildLlmTaskInput,
    ContextAssembler,
    type DurableAgentInput,
    type DurableChatOutput as ChatProgramOutput,
} from '@itookit/llm-programs';
import type { IChatEngine } from '../persistence/types';
import { ContextProfileStore } from '../persistence/context-profile-store';
import { RoundLog } from '../persistence/round-log';
import { SessionEventBus } from './session-event-bus';
import { SessionState } from './session-state';
import { DurableFlowExecutor } from '@itookit/llm-flow';

export interface ConversationExecution {
    task: ExecutionTask;
    state: SessionState;
    config: ExecutorConfig;
    log: RoundLog;
    rootNodeId: string;
    roundId: string;
    contextFiles: ChatAttachment[];
    finalize(): Promise<void>;
}

export interface ConversationRunCoordinatorOptions {
    engine: IChatEngine;
    eventBus: SessionEventBus;
    harness: Harness;
    dagPlugins: DagPluginCatalog;
    resolveTools?(sessionId: string, allowedIds: string[]): Promise<{
        definitions: ToolDefinition[];
        externalIds: string[];
    }>;
    loadArtifact(id: string): Promise<Artifact | null>;
}

interface ConversationLocation {
    branchRef: string;
    branchHead: string | null;
}

export class ConversationRunCoordinator {
    private readonly active = new Map<string, TaskHandle[]>();

    constructor(private readonly options: ConversationRunCoordinatorOptions) {}

    async executeDirect(execution: ConversationExecution): Promise<void> {
        await this.execute(execution, async snapshot => {
            const root = await this.directTask(execution, snapshot);
            return { root, tasks: [root], parse: parseOutput };
        });
    }

    async executeDag(
        execution: ConversationExecution,
        createSpec: (snapshot: ContextSnapshot) => DagRunSpec,
    ): Promise<void> {
        await this.execute(execution, async snapshot => {
            const flow = new DurableFlowExecutor({
                harness: this.options.harness,
                plugins: this.options.dagPlugins,
                resolveTools: this.options.resolveTools,
            });
            const submitted = await flow.submit(execution.task.sessionId, createSpec(snapshot));
            return { root: submitted.root, tasks: [...submitted.nodes.values()], parse: parseDagOutput };
        });
    }

    private async execute(
        execution: ConversationExecution,
        createTask: (snapshot: ContextSnapshot) => Promise<{
            root: TaskHandle;
            tasks: TaskHandle[];
            parse: (value: unknown) => ChatProgramOutput;
        }>,
    ): Promise<void> {
        const location = await this.resolveLocation(execution);
        const snapshot = await this.assembleContext(execution, location);
        const submission = await createTask(snapshot);
        const handle = submission.root;
        this.active.set(execution.task.sessionId, submission.tasks);
        let roundStarted = false;
        const streamedOutput = { output: false };
        try {
            await this.startRound(execution, location, handle.id);
            roundStarted = true;
            this.projectRun(execution, handle.id);
            const output = await this.consume(
                handle, submission.tasks, execution.task.sessionId, execution.rootNodeId, submission.parse, streamedOutput,
            );
            await this.completeRound(execution, output, streamedOutput);
            await execution.finalize();
        } catch (error) {
            if (roundStarted) await this.failRound(execution);
            throw error;
        } finally {
            this.active.delete(execution.task.sessionId);
        }
    }

    signal(sessionId: string, signal: Signal): boolean {
        const handles = this.active.get(sessionId);
        if (!handles?.length) return false;
        if (signal.type === 'respond') {
            for (const handle of handles) {
                void handle.respond({ interactionId: signal.requestId, value: jsonValue(signal.response) }).catch(() => {});
            }
            return true;
        }
        if (signal.type !== 'inject') return false;
        for (const handle of handles) {
            void handle.signal({ type: 'inject', payload: { text: signal.text } }).catch(() => {});
        }
        return true;
    }

    cancel(sessionId: string): void {
        for (const handle of this.active.get(sessionId) ?? []) void handle.cancel().catch(() => {});
    }

    cancelAll(): void {
        for (const handles of this.active.values()) {
            for (const handle of handles) void handle.cancel().catch(() => {});
        }
        this.active.clear();
    }

    private async resolveLocation(
        execution: ConversationExecution,
    ): Promise<ConversationLocation> {
        const manifest = await execution.log.loadManifest();
        const branchRef = execution.task.frozen?.branchRef
            ?? manifest.currentBranch
            ?? 'main';
        const branchHead = execution.task.frozen?.branchHead
            ?? manifest.branches[branchRef]
            ?? null;
        return { branchRef, branchHead };
    }

    private async assembleContext(
        execution: ConversationExecution,
        location: ConversationLocation,
    ): Promise<ContextSnapshot> {
        const manifest = await execution.log.loadManifest();
        const profile = manifest.branchMeta[location.branchRef]?.contextProfile
            ?? { id: '', revision: 0 };
        const assembler = this.contextAssembler(execution);
        const version = execution.task.frozen?.agentVersion
            ?? execution.config.agentVersion
            ?? 'unversioned';
        const result = await assembler.assemble(contextPlan(execution, location, profile), execution.task.id, {
            id: execution.config.id,
            version,
        }, execution.config.systemPrompt, undefined, { persist: false });
        return result.snapshot;
    }

    private contextAssembler(
        execution: ConversationExecution,
    ): ContextAssembler {
        return new ContextAssembler({
            log: execution.log,
            profileStore: new ContextProfileStore(this.options.engine, execution.task.nodeId),
            readRound: roundId => execution.log.readRound(roundId),
            loadArtifact: id => this.options.loadArtifact(id),
        });
    }

    private async directTask(
        execution: ConversationExecution,
        snapshot: ContextSnapshot,
    ): Promise<TaskHandle<ChatProgramOutput>> {
        const session = await this.options.harness.openSession(execution.task.sessionId);
        const tools = execution.config.capabilityPolicy?.toolIds ?? [];
        const catalog = await this.options.resolveTools?.(execution.task.sessionId, tools)
            ?? { definitions: [], externalIds: [] };
        const spec = directTaskSpec(execution, snapshot, catalog);
        const handle = await session.submit<typeof spec.input, ChatProgramOutput>(spec);
        await this.bindCapabilities(handle, tools.length > 0);
        if (execution.task.abortController.signal.aborted) await handle.cancel();
        return handle;
    }

    private async bindCapabilities(
        task: TaskHandle,
        tools: boolean,
    ): Promise<void> {
        await bindCapabilities(task, [
            { kind: 'llm', uri: 'llm://session', rights: ['execute', 'write'], signalKey: 'llmHandleId' },
            ...(tools ? [{ kind: 'tool', uri: 'tool://session', rights: ['execute'], signalKey: 'toolHandleId' } satisfies CapabilityBinding] : []),
        ] satisfies CapabilityBinding[]);
    }

    private async startRound(
        execution: ConversationExecution,
        location: ConversationLocation,
        taskId: string,
    ): Promise<void> {
        const existing = await execution.log.readRound(execution.roundId);
        if (existing) {
            await execution.log.attachExecution(execution.roundId, { taskId, role: 'primary' });
            return;
        }
        const userMessage = createUserMessage(execution.task.input.text, execution.contextFiles);
        await execution.log.appendExpected(
            location.branchRef,
            conversationRound(execution, location, userMessage, taskId),
            location.branchHead,
        );
    }

    private projectRun(execution: ConversationExecution, taskId: string): void {
        this.options.eventBus.emitGlobal({
            type: 'execution_task_projected',
            payload: {
                sessionId: execution.task.sessionId,
                taskId,
                roundId: execution.roundId,
            },
        });
    }

    private async consume(
        handle: TaskHandle,
        eventTasks: TaskHandle[],
        sessionId: string,
        rootNodeId: string,
        parse: (value: unknown) => ChatProgramOutput,
        streamedOutput: { output: boolean },
    ): Promise<ChatProgramOutput> {
        const events = Promise.all(eventTasks.map(task => this.consumeEvents(task, sessionId, rootNodeId, streamedOutput)));
        const exit = await handle.wait();
        await events;
        if (exit.status === 'failed') throw new Error(exit.error?.message ?? `Task failed: ${handle.id}`);
        if (exit.status === 'cancelled') throw new Error(`Task cancelled: ${handle.id}`);
        return parse(exit.output);
    }

    private async consumeEvents(
        handle: TaskHandle,
        sessionId: string,
        rootNodeId: string,
        streamedOutput: { output: boolean },
    ): Promise<void> {
        for await (const envelope of handle.events()) {
            this.forwardAgentEvent(envelope, sessionId, rootNodeId, streamedOutput);
        }
    }

    private forwardAgentEvent(
        envelope: EventEnvelope,
        sessionId: string,
        rootNodeId: string,
        streamedOutput: { output: boolean },
    ): void {
        const event = getAgentEvent(envelope);
        if (!event || event.type === 'finished' || event.type === 'error') return;

        // Convert stream events to message:updated for incremental rendering pipeline.
        // These accumulate in EventBatchProcessor and drive StreamController → MDxController.
        // We do NOT return early — the original event is still emitted so stream:content
        // (in immediateTypes) triggers an immediate flush of the queued message:updated.
        if (event.type === 'stream:content') {
            streamedOutput.output = true;
            this.options.eventBus.emitSession(sessionId, {
                type: 'message:updated',
                payload: { messageId: rootNodeId, delta: event.delta, field: 'output' },
            });
        }
        if (event.type === 'stream:thinking') {
            this.options.eventBus.emitSession(sessionId, {
                type: 'message:updated',
                payload: { messageId: rootNodeId, delta: event.delta, field: 'thought' },
            });
        }

        this.options.eventBus.emitSession(sessionId, event);
    }

    private async completeRound(
        execution: ConversationExecution,
        output: ChatProgramOutput,
        streamedOutput: { output: boolean },
    ): Promise<void> {
        await execution.log.setAssistantInRound(execution.roundId, {
            assistantMessages: [output.message],
            agentId: execution.config.id,
            result: roundResult(output),
        });
        projectOutput(this.options.eventBus, execution, output, streamedOutput.output);
    }

    private async failRound(execution: ConversationExecution): Promise<void> {
        const status = execution.task.abortController.signal.aborted
            ? 'cancelled'
            : 'failed';
        await execution.log.setConversationStatus(execution.roundId, status);
    }
}

function contextPlan(
    execution: ConversationExecution,
    location: ConversationLocation,
    profile: { id: string; revision: number },
) {
    return {
        branchRef: location.branchRef,
        branchHead: location.branchHead,
        profile,
        pendingUserMessage: { role: 'user' as const, content: execution.task.input.text },
        explicitInputs: [],
        tokenBudget: execution.config.defaultContextPolicy?.tokenBudget,
    };
}

function directTaskSpec(
    execution: ConversationExecution,
    snapshot: ContextSnapshot,
    catalog: { definitions: ToolDefinition[]; externalIds: string[] },
): TaskSpec<DurableAgentInput> {
    const tools = execution.config.capabilityPolicy?.toolIds ?? [];
    return {
        program: { kind: tools.length ? 'llm.agent' : 'llm.chat', version: '1' },
        input: buildLlmTaskInput({
            sessionId: execution.task.sessionId,
            roundId: execution.roundId,
            messages: snapshot.canonicalMessages,
            connectionId: execution.config.connectionId,
            model: execution.config.model,
            temperature: execution.config.temperature,
            maxTokens: execution.config.constraints?.maxTokens,
            thinking: execution.config.enableThinking,
            reasoningEffort: execution.config.reasoningEffort,
            stream: execution.config.stream,
            approval: 'external',
            tools: catalog.definitions,
            externalToolIds: catalog.externalIds,
        }),
        labels: { roundId: execution.roundId, kind: tools.length ? 'agent' : 'chat' },
        deferStart: true,
    };
}

function conversationRound(
    execution: ConversationExecution,
    location: ConversationLocation,
    userMessage: ChatMessage,
    taskId: string,
): import('@itookit/common').Round {
    const parents = location.branchHead ? [location.branchHead] : [];
    const temporary = execution.task.input.sendIntent?.retention.mode === 'temporary';
    return {
        id: execution.roundId,
        sessionId: execution.task.sessionId,
        historyParentIds: parents,
        exposure: temporary ? 'internal' : 'public',
        input: [userMessage],
        output: [],
        executions: [{ taskId, role: 'primary' }],
        status: 'running',
        createdAt: Date.now(),
        origin: 'user',
        defaultContextMode: temporary ? 'exclude' : 'include',
        defaultContextScope: 'subtree',
    };
}

function createUserMessage(text: string, files: ChatAttachment[]): ChatMessage {
    const message: ChatMessage = { role: 'user', content: text };
    if (files.length) {
        message.attachments = files.map(file => ({
            name: file.name,
            type: file.type as import('@itookit/common').AttachmentType,
            source: file.path ?? file.name,
            size: file.size,
        }));
    }
    return message;
}

function roundResult(output: ChatProgramOutput) {
    return {
        assistantBlocks: [{ type: 'text' as const, content: output.message.content }],
        toolResults: [],
        usage: output.usage,
        finishReason: output.finishReason ?? undefined,
    };
}

function projectOutput(
    eventBus: SessionEventBus,
    execution: ConversationExecution,
    output: ChatProgramOutput,
    streamed: boolean,
): void {
    const content = typeof output.message.content === 'string'
        ? output.message.content
        : JSON.stringify(output.message.content ?? '');
    execution.state.updateNodeOutput(execution.rootNodeId, content);
    execution.state.updateNodeStatus(execution.rootNodeId, 'success');
    // When the output was already streamed via message:updated deltas (StreamController
    // appends), emitting the full content here would double-render it. The authoritative
    // state write above still lands; only the UI delta is skipped.
    if (!streamed) {
        eventBus.emitSession(execution.task.sessionId, {
            type: 'message:updated',
            payload: { messageId: execution.rootNodeId, field: 'output', delta: content },
        });
    }
    eventBus.emitSession(execution.task.sessionId, {
        type: 'message:status',
        payload: { messageId: execution.rootNodeId, status: 'success' },
    });
    eventBus.emitSession(execution.task.sessionId, {
        type: 'finished',
        usage: output.usage,
    });
}

function getAgentEvent(envelope: EventEnvelope): AgentEvent | undefined {
    if (envelope.type === 'agent.event') return envelope.payload as AgentEvent;
    if (envelope.type !== 'task.interaction.requested') return undefined;
    const request = record(envelope.payload);
    return {
        type: 'await_signal',
        request: {
            requestId: String(request.id ?? ''),
            reason: request.kind === 'input' ? 'request_input' : 'hitl_confirm',
            message: String(request.prompt ?? ''),
        },
    };
}

function parseOutput(value: unknown): ChatProgramOutput {
    if (!value || typeof value !== 'object') {
        throw new Error('Chat process returned an invalid output');
    }
    const output = value as Partial<ChatProgramOutput>;
    if (!output.message || output.message.role !== 'assistant') {
        throw new Error('Chat process output is missing an assistant message');
    }
    return {
        message: output.message,
        usage: output.usage ?? {},
        finishReason: output.finishReason,
    };
}

function parseDagOutput(value: unknown): ChatProgramOutput {
    const contents = collectArtifactContents(record(value).nodes);
    return { message: { role: 'assistant', content: contents.join('\n\n') }, usage: {} };
}

function collectArtifactContents(value: unknown): string[] {
    if (!value || typeof value !== 'object') return [];
    if ('content' in value) return [stringify((value as { content: unknown }).content)];
    if ('message' in value) return collectArtifactContents((value as { message: unknown }).message);
    return Object.values(value).flatMap(collectArtifactContents);
}

function stringify(value: unknown): string {
    return typeof value === 'string' ? value : JSON.stringify(value);
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function jsonValue(value: unknown): JsonValue {
    return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
}
