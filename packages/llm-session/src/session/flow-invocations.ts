import type { FlowRevision, ICommandBus, JsonValue, DagRunSpec } from '@itookit/common';
import type { Kernel, TaskRecord, SessionHandle } from '@itookit/durable-kernel';
import { FlowCommand, FlowDefinitionStore, validateFlowParameters } from '@itookit/llm-flow';

export const FlowInvocationCommand = { Invoke: 'session.flow.invoke', List: 'session.flow.invocations' } as const;
export interface FlowInvocationInput { sessionId: string; requestId: string; flowId: string; revision: number; parameters: Record<string, JsonValue> }
export interface FlowInvocationRecord extends FlowInvocationInput {
    flow: FlowRevision;
    createdAt: number;
    rootTaskId?: string;
    error?: string;
    branch?: string;
    head?: string | null;
}
const PREFIX = 'flow.invocation.';

/** Calls live beside chat history; their completion never moves the conversation head. */
export class FlowInvocationService {
    private pending = new Map<string, Promise<FlowInvocationRecord>>();
    constructor(private kernel: Kernel, private definitions: FlowDefinitionStore, private commands: ICommandBus,
        private canWrite?: (id: string) => Promise<boolean>,
        private source?: (id: string) => Promise<{ branch: string; head: string | null }>) {}

    register(): void {
        this.commands.register(FlowInvocationCommand.Invoke, args => this.invoke(args as FlowInvocationInput));
        this.commands.register(FlowInvocationCommand.List, args => this.list((args as { sessionId: string }).sessionId));
    }

    async invoke(input: FlowInvocationInput): Promise<FlowInvocationRecord> {
        if (!/^[\w-]{1,128}$/.test(input.requestId)) throw new Error('Invalid Flow invocation request id');
        const key = `${input.sessionId}/${input.requestId}`;
        const previous = this.pending.get(key);
        if (previous) { const record = await previous; this.assertSame(record, input); return record; }
        const operation = this.submit(structuredClone(input));
        this.pending.set(key, operation);
        try { return await operation; } finally { this.pending.delete(key); }
    }

    async list(sessionId: string): Promise<FlowInvocationRecord[]> {
        const session = await this.kernel.inspectSession(sessionId);
        const entries = await this.kernel.listShared(sessionId, PREFIX);
        const tasks = await session.listTasks();
        return entries.map(entry => {
            const record = entry.value as unknown as FlowInvocationRecord;
            const root = this.findRoot(tasks, record.requestId);
            return { ...record, ...(root ? { rootTaskId: root.id, error: undefined } : {}) };
        }).sort((a, b) => a.createdAt - b.createdAt);
    }

    async recover(): Promise<void> {
        for await (const session of this.kernel.listSessions()) {
            const status = await this.kernel.sessionStat(session.id);
            if (status.phase !== 'open' || status.archived) continue;
            if (this.canWrite && !await this.canWrite(session.id)) continue;
            for (const record of await this.list(session.id)) {
                try {
                    if (!record.rootTaskId && !record.error) await this.invoke(record);
                    else if (record.rootTaskId) await this.commands.execute(FlowCommand.RunResume, { sessionId: session.id, taskId: record.rootTaskId });
                } catch (error) { console.error('Flow invocation recovery failed', session.id, record.requestId, error); }
            }
        }
    }

    private async submit(input: FlowInvocationInput): Promise<FlowInvocationRecord> {
        await this.assertWritable(input.sessionId);
        const session = await this.kernel.openSession(input.sessionId), key = PREFIX + input.requestId;
        let record = await this.admit(input, session);
        const existing = this.findRoot(await session.listTasks(), input.requestId);
        if (existing) return { ...record, rootTaskId: existing.id, error: undefined };
        const invocation: DagRunSpec['invocation'] = { requestId: input.requestId, flowId: input.flowId,
            revision: record.flow.revision, digest: record.flow.digest, name: record.flow.name, createdAt: record.createdAt,
            ...(record.branch ? { branch: record.branch, head: record.head } : {}) };
        try {
            await this.assertWritable(input.sessionId);
            const { taskId } = await this.commands.execute<{ taskId: string }>(FlowCommand.RunStart, {
                sessionId: input.sessionId, flow: record.flow, parameters: record.parameters, invocation,
            });
            record = { ...record, rootTaskId: taskId, error: undefined };
        } catch (error) {
            const root = this.findRoot(await session.listTasks(), input.requestId);
            if (root) return { ...record, rootTaskId: root.id, error: undefined };
            await session.setShared(key, json({ ...record, error: String(error) }));
            throw error;
        }
        await session.setShared(key, json(record));
        return record;
    }

    private async admit(input: FlowInvocationInput, session: SessionHandle): Promise<FlowInvocationRecord> {
        const key = PREFIX + input.requestId;
        const saved = await session.getShared(key);
        let record = saved?.value as unknown as FlowInvocationRecord | undefined;
        if (record) this.assertSame(record, input);
        else {
            const flow = await this.definitions.loadRevision(input.flowId, input.revision);
            if (!flow) throw new Error(`Flow revision not found: ${input.flowId}@${input.revision}`);
            const issues = validateFlowParameters(flow.parameters, input.parameters);
            for (const name of Object.keys(input.parameters)) if (!(flow.parameters ?? []).some(field => field.name === name)) throw new Error(`Unknown Flow parameter: ${name}`);
            if (issues.length) throw new Error(issues.map(issue => issue.message).join('; '));
            record = { ...input, flow, createdAt: Date.now(), ...await this.source?.(input.sessionId) };
            await session.setShared(key, json(record), { expectedVersion: null });
        }
        return record;
    }

    private findRoot(tasks: TaskRecord[], requestId: string): TaskRecord | undefined {
        return tasks.find(task => task.labels?.kind === 'flow-root'
            && (task.input as { initialScheduler?: { spec?: DagRunSpec } })?.initialScheduler?.spec?.invocation?.requestId === requestId);
    }

    private assertSame(record: FlowInvocationRecord, input: FlowInvocationInput): void {
        if (record.flowId !== input.flowId || record.revision !== input.revision || canonical(record.parameters) !== canonical(input.parameters)) {
            throw new Error('Flow invocation request id was already used with different arguments');
        }
    }

    private async assertWritable(sessionId: string): Promise<void> {
        if (this.canWrite && !await this.canWrite(sessionId)) throw new Error('Session is owned by another host');
        const status = await this.kernel.sessionStat(sessionId);
        if (status.phase !== 'open' || status.archived) throw new Error('Session is not open');
    }
}

function json(value: unknown): JsonValue { return JSON.parse(JSON.stringify(value)); }
function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') return JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
    return JSON.stringify(value);
}
