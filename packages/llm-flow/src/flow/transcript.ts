import { readFlowRunMembers } from './run-members';
import type { Kernel, TaskRecord } from '@itookit/durable-kernel';

export interface FlowTranscriptQuery { version?: number; offset?: number; limit?: number; }

export interface FlowTaskTranscript {
    totalEffects: number;
    nextOffset?: number;
    sessionId: string;
    runTaskId: string;
    taskId: string;
    nodeId?: string;
    status: TaskRecord['status'];
    version: number;
    input: unknown;
    output: unknown;
    effects: Array<{ effectId: string } & TaskRecord['effects'][string]>;
    interactions: TaskRecord['interactions'];
}

/** Read recorded exchanges, including those removed from the Agent's compacted message window. */
export async function readFlowTaskTranscript(
    kernel: Kernel, sessionId: string, runTaskId: string, taskId: string, query: FlowTranscriptQuery = {},
): Promise<FlowTaskTranscript> {
    const offset = query.offset ?? 0, limit = query.limit ?? 100;
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 500
        || (offset > 0 && query.version === undefined)
        || (query.version !== undefined && (!Number.isSafeInteger(query.version) || query.version < 0))) {
        throw new Error('Invalid transcript page');
    }
    const session = await kernel.openSession(sessionId);
    const root = (await (await session.attachTask(runTaskId)).status()).task;
    const entries = await readFlowRunMembers(session, root);
    if (taskId !== runTaskId && !entries.some(item => item.taskId === taskId)) {
        throw new Error(`Task is outside this run: ${taskId}`);
    }
    const task = query.version === undefined
        ? taskId === runTaskId ? root : (await (await session.attachTask(taskId)).status()).task
        : (await kernel.taskHistoryPage(sessionId, taskId, {
            afterVersion: query.version - 1, throughVersion: query.version, limit: 1,
        })).items[0];
    if (!task || (query.version !== undefined && task.version !== query.version)) throw new Error('Transcript version unavailable');
    const effects = Object.entries(task.effects).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    if (offset > effects.length) throw new Error('Invalid transcript offset');
    return {
        totalEffects: effects.length,
        ...(offset + limit < effects.length ? { nextOffset: offset + limit } : {}),
        sessionId, runTaskId, taskId, nodeId: task.labels?.flowNodeId,
        status: task.status, version: task.version, input: task.input, output: task.output,
        effects: effects.slice(offset, offset + limit).map(([effectId, effect]) => ({ effectId, ...effect })),
        interactions: task.interactions,
    };
}
