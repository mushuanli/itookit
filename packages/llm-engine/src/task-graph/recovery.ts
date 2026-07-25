import type { TaskGraphRun, TaskRunId } from '@itookit/common';
import { InMemoryTaskGraphRunStore } from './stores';

export interface RecoveryResult {
    run: TaskGraphRun;
    interruptedTaskRunIds: TaskRunId[];
}

/** Apply the v3 cold-restart boundary without replaying executable work. */
export function recoverTaskGraphRun(run: TaskGraphRun): RecoveryResult {
    const recovered = structuredClone(run);
    const interrupted: TaskRunId[] = [];
    for (const task of Object.values(recovered.tasks ?? {})) {
        if (!['running', 'retrying', 'awaiting_signal'].includes(task.status)) continue;
        task.status = 'interrupted';
        task.completedAt = Date.now();
        interrupted.push(task.id);
        const attempt = [...task.attempts].reverse().find(item => item.status === 'running');
        if (attempt) {
            attempt.status = 'interrupted';
            attempt.completedAt = Date.now();
            attempt.error = { message: 'Application restarted before TaskRun completed', code: 'INTERRUPTED' };
        }
        for (const edge of recovered.edges ?? []) {
            if (String(edge.from) !== String(task.id)) continue;
            const state = recovered.edgeStates?.[edge.id];
            if (state && ['pending', 'activated'].includes(state.state)) {
                state.state = 'failed';
                state.reason = 'source interrupted during recovery';
                state.updatedAt = Date.now();
            }
        }
    }
    return { run: recovered, interruptedTaskRunIds: interrupted };
}

export class TaskGraphRecoveryService {
    constructor(private readonly runStore: InMemoryTaskGraphRunStore) {}

    async recover(graphRunId: import('@itookit/common').TaskGraphRunId): Promise<RecoveryResult> {
        const run = await this.runStore.get(graphRunId);
        if (!run) throw new Error(`TaskGraphRun not found: ${graphRunId}`);
        const result = recoverTaskGraphRun(run);
        await this.runStore.save(result.run);
        return result;
    }
}

