import type { ISessionRepository } from '../persistence/types';
import type { TaskInput } from '../core/types';
import { directExecutionMode, snapshotTaskInput } from './direct-execution-mode';
import { assertExecutionMode } from './execution-mode-policy';

/** Resolve the persistent session policy before constructing a new direct task. */
export async function resolveSessionExecutionMode(engine: Pick<ISessionRepository, 'getSessionSettings'>, input: TaskInput): Promise<TaskInput> {
    if (input.sendIntent?.execution.kind === 'flow' || input.overrides?.flowId) return input;
    const settings = await engine.getSessionSettings(input.sessionId);
    const requested = directExecutionMode(input);
    if (!settings.executionModeLocked) return input;
    const mode = settings.executionMode ?? 'chat';
    assertExecutionMode(settings, requested);
    return snapshotTaskInput({ ...input, overrides: { ...input.overrides, executionMode: mode } });
}
