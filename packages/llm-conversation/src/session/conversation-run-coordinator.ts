import type {
    AgentEvent,
    Artifact,
    ChatMessage,
    ContextSnapshot,
    DagRunSpec,
    ProcessHost,
    ProcessSignal,
    RunEventEnvelope,
    RunHandle,
    Signal,
} from '@itookit/common';
import type {
    ChatAttachment,
    ExecutionTask,
    ExecutorConfig,
} from '../core/types';
import {
    ContextAssembler,
    type ChatProgramOutput,
} from '@itookit/llm-engine';
import type { IChatEngine } from '../persistence/types';
import { ContextProfileStore } from '../persistence/context-profile-store';
import { RoundLog } from '../persistence/round-log';
import { SessionEventBus } from './session-event-bus';
import { SessionState } from './session-state';

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
    processHost: ProcessHost;
    loadArtifact(id: string): Promise<Artifact | null>;
}

interface ConversationLocation {
    branchRef: string;
    branchHead: string | null;
}

export class ConversationRunCoordinator {
    private readonly active = new Map<string, RunHandle>();

    constructor(private readonly options: ConversationRunCoordinatorOptions) {}

    async executeDirect(execution: ConversationExecution): Promise<void> {
        await this.execute(execution, snapshot => ({
            scheduler: 'direct',
            spec: directProcessSpec(execution, snapshot),
        }), parseProcessOutput);
    }

    async executeDag(
        execution: ConversationExecution,
        createSpec: (snapshot: ContextSnapshot) => DagRunSpec,
    ): Promise<void> {
        await this.execute(execution, snapshot => ({
            scheduler: 'dag',
            spec: createSpec(snapshot),
        }), parseDagOutput);
    }

    private async execute(
        execution: ConversationExecution,
        request: (snapshot: ContextSnapshot) => import('@itookit/common').RunRequest,
        parse: (value: unknown) => ChatProgramOutput,
    ): Promise<void> {
        const location = await this.resolveLocation(execution);
        const snapshot = await this.assembleContext(execution, location);
        const handle = await this.submit(execution, request(snapshot));
        this.active.set(execution.task.sessionId, handle);
        let roundStarted = false;
        try {
            await this.startRound(execution, location, handle.runId);
            roundStarted = true;
            this.projectRun(execution, handle.runId);
            const output = await this.consume(handle, execution.task.sessionId, parse, execution.rootNodeId);
            await this.completeRound(execution, output);
            await execution.finalize();
        } catch (error) {
            if (roundStarted) await this.failRound(execution);
            throw error;
        } finally {
            this.active.delete(execution.task.sessionId);
        }
    }

    signal(sessionId: string, signal: Signal): boolean {
        const handle = this.active.get(sessionId);
        const processSignal = toProcessSignal(signal);
        if (!handle || !processSignal) return false;
        void handle.signal(processSignal).catch(() => {});
        return true;
    }

    cancel(sessionId: string): void {
        void this.active.get(sessionId)?.cancel().catch(() => {});
    }

    cancelAll(): void {
        for (const handle of this.active.values()) {
            void handle.cancel().catch(() => {});
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

    private async submit(
        execution: ConversationExecution,
        request: import('@itookit/common').RunRequest,
    ): Promise<RunHandle> {
        const handle = await this.options.processHost.submit({
            ...request,
            ownerRoundId: execution.roundId,
        });
        if (execution.task.abortController.signal.aborted) await handle.cancel();
        return handle;
    }

    private async startRound(
        execution: ConversationExecution,
        location: ConversationLocation,
        runId: string,
    ): Promise<void> {
        const existing = await execution.log.readRound(execution.roundId);
        if (existing) {
            await execution.log.attachExecution(execution.roundId, { runId, role: 'primary' });
            return;
        }
        const userMessage = createUserMessage(execution.task.input.text, execution.contextFiles);
        await execution.log.appendExpected(
            location.branchRef,
            conversationRound(execution, location, userMessage, runId),
            location.branchHead,
        );
    }

    private projectRun(execution: ConversationExecution, runId: string): void {
        this.options.eventBus.emitGlobal({
            type: 'execution_run_projected',
            payload: {
                sessionId: execution.task.sessionId,
                runId,
                roundId: execution.roundId,
            },
        });
    }

    private async consume(
        handle: RunHandle,
        sessionId: string,
        parse: (value: unknown) => ChatProgramOutput,
        rootNodeId: string,
    ): Promise<ChatProgramOutput> {
        let output: ChatProgramOutput | undefined;
        for await (const envelope of handle.events()) {
            this.forwardAgentEvent(envelope, sessionId, rootNodeId);
            if (envelope.event.type === 'run:completed') {
                output = parse(envelope.event.output);
            }
            if (envelope.event.type === 'run:failed') {
                throw new Error(envelope.event.error.message);
            }
        }
        if (!output) throw new Error(`Direct run ${handle.runId} completed without chat output`);
        return output;
    }

    private forwardAgentEvent(envelope: RunEventEnvelope, sessionId: string, rootNodeId: string): void {
        const event = getAgentEvent(envelope);
        if (!event || event.type === 'finished' || event.type === 'error') return;

        // Convert stream events to message:updated for incremental rendering pipeline.
        // These accumulate in EventBatchProcessor and drive StreamController → MDxController.
        // We do NOT return early — the original event is still emitted so stream:content
        // (in immediateTypes) triggers an immediate flush of the queued message:updated.
        if (event.type === 'stream:content') {
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
    ): Promise<void> {
        await execution.log.setAssistantInRound(execution.roundId, {
            assistantMessages: [output.message],
            agentId: execution.config.id,
            result: roundResult(output),
        });
        projectOutput(this.options.eventBus, execution, output);
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

function directProcessSpec(execution: ConversationExecution, snapshot: ContextSnapshot) {
    const tools = execution.config.capabilityPolicy?.toolIds ?? [];
    return {
        programKind: tools.length ? 'llm.agent' : 'llm.chat',
        input: {
            sessionId: execution.task.sessionId,
            roundId: execution.roundId,
            messages: snapshot.canonicalMessages,
            connectionId: execution.config.connectionId ?? 'default',
            model: execution.config.model,
            temperature: execution.config.temperature,
            maxTokens: execution.config.constraints?.maxTokens,
            thinking: execution.config.enableThinking,
            reasoningEffort: execution.config.reasoningEffort,
            approval: 'external',
        },
        capabilities: tools,
    };
}

function conversationRound(
    execution: ConversationExecution,
    location: ConversationLocation,
    userMessage: ChatMessage,
    runId: string,
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
        executions: [{ runId, role: 'primary' }],
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
        finishReason: output.finishReason,
    };
}

function projectOutput(
    eventBus: SessionEventBus,
    execution: ConversationExecution,
    output: ChatProgramOutput,
): void {
    const content = typeof output.message.content === 'string'
        ? output.message.content
        : JSON.stringify(output.message.content ?? '');
    execution.state.updateNodeOutput(execution.rootNodeId, content);
    execution.state.updateNodeStatus(execution.rootNodeId, 'success');
    eventBus.emitSession(execution.task.sessionId, {
        type: 'message:updated',
        payload: { messageId: execution.rootNodeId, field: 'output', delta: content },
    });
    eventBus.emitSession(execution.task.sessionId, {
        type: 'message:status',
        payload: { messageId: execution.rootNodeId, status: 'success' },
    });
    eventBus.emitSession(execution.task.sessionId, {
        type: 'finished',
        usage: output.usage,
    });
}

function getAgentEvent(envelope: RunEventEnvelope): AgentEvent | undefined {
    if (envelope.event.type !== 'process:event') return undefined;
    const event = envelope.event.event;
    return event.type === 'agent-event' ? event.event : undefined;
}

function parseProcessOutput(value: unknown): ChatProgramOutput {
    return parseOutput(record(value).result);
}

function parseDagOutput(value: unknown): ChatProgramOutput {
    const contents = collectArtifactContents(record(value).nodes);
    return {
        message: { role: 'assistant', content: contents.join('\n\n') },
        usage: {},
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

function collectArtifactContents(value: unknown): string[] {
    if (!value || typeof value !== 'object') return [];
    if ('content' in value) return [stringify((value as { content: unknown }).content)];
    return Object.values(value).flatMap(collectArtifactContents);
}

function stringify(value: unknown): string {
    return typeof value === 'string' ? value : JSON.stringify(value);
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function toProcessSignal(signal: Signal): ProcessSignal | undefined {
    if (signal.type === 'respond' || signal.type === 'inject') return signal;
    if (signal.type === 'abort') return { type: 'cancel' };
    return undefined;
}
