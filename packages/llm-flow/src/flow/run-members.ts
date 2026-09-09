import type { SessionHandle, TaskRecord, TaskHandle } from '@itookit/durable-kernel';

export interface FlowRunMember {
    taskId: string;
    nodeId: string;
    iteration: number;
    detached: boolean;
    budget?: Record<string, number>;
    retryOfTaskId?: string;
}

export async function readFlowRunMembers(session: SessionHandle, root: TaskRecord): Promise<FlowRunMember[]> {
    if (root.program.kind !== 'flow.aggregate' || root.labels?.kind !== 'flow-root') throw new Error(`Not a Flow run: ${root.id}`);
    const scheduled = await session.getShared(`flow.run.${root.id}.members`);
    const base = members(scheduled?.value ?? (root.input as { runTasks?: unknown } | undefined)?.runTasks);
    const saved = await session.getShared(`flow.run.${root.id}.retries`);
    return [...base, ...members(saved?.value ?? [])];
}

/** Prepare a deferred retry and publish membership before any authorization or execution. */
export async function prepareFlowTaskRetry(session: SessionHandle, rootId: string, sourceId: string, requestId: string): Promise<TaskHandle> {
    if (typeof requestId !== 'string' || !requestId.trim()) throw new Error('Flow retry requires requestId');
    const root = (await (await session.attachTask(rootId)).status()).task;
    const entries = await readFlowRunMembers(session, root);
    const source = entries.find(entry => entry.taskId === sourceId);
    if (!source) throw new Error(`Task is outside this run: ${sourceId}`);
    const retry = await (await session.attachTask(sourceId)).retry({ requestId: `${rootId}:${requestId}` });
    const key = `flow.run.${rootId}.retries`;
    for (let attempt = 0; attempt < 3; attempt++) {
        const saved = await session.getShared(key), current = members(saved?.value ?? []);
        if (current.some(entry => entry.taskId === retry.id)) return retry;
        const iteration = Math.max(...entries.concat(current).filter(entry => entry.nodeId === source.nodeId).map(entry => entry.iteration)) + 1;
        if (!Number.isSafeInteger(iteration)) throw new Error('Flow iteration overflow');
        const entry = { ...source, taskId: retry.id, iteration, retryOfTaskId: sourceId };
        try {
            await session.setShared(key, JSON.parse(JSON.stringify([...current, entry])), { expectedVersion: saved?.version ?? null });
            return retry;
        } catch (error) { if (attempt === 2) throw error; }
    }
    throw new Error('Flow retry membership unavailable');
}

function members(value: unknown): FlowRunMember[] {
    if (!Array.isArray(value) || value.some(entry => !entry || typeof entry.taskId !== 'string' || !entry.taskId
        || typeof entry.nodeId !== 'string' || !entry.nodeId || !Number.isSafeInteger(entry.iteration) || entry.iteration < 1)) {
        throw new Error('Invalid Flow membership record');
    }
    return value;
}
