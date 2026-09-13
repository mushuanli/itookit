import type { JsonValue, SessionHandle, TaskHandle } from '@itookit/durable-kernel';
import type { FlowWorkspaceLease } from './executor';

export interface WorkspaceFinalization { status: 'pending' | 'succeeded' | 'failed'; message?: string; persistenceError?: string; }
export const workspaceFinalizationKey = (taskId: string): string => `flow.run.${taskId}.workspace`;

export async function beginWorkspaceFinalization(session: SessionHandle, root: TaskHandle<JsonValue>, workspace: FlowWorkspaceLease) {
    const state: WorkspaceFinalization = { status: 'pending' };
    const save = () => session.setShared(workspaceFinalizationKey(root.id), { ...state });
    await save();
    const completion = (async () => {
        let cleanupError: unknown;
        try {
            const exit = await root.wait().catch(() => ({ status: 'failed' }));
            await workspace.releaseCapabilities?.(root.id);
            await workspace.finish(exit.status === 'succeeded' ? 'succeeded' : exit.status === 'cancelled' ? 'cancelled' : 'failed');
            state.status = 'succeeded';
        } catch (error) {
            cleanupError = error;
            state.status = 'failed';
            state.message = error instanceof Error ? error.message : String(error);
        }
        try { await save(); }
        catch (saveError) {
            state.persistenceError = saveError instanceof Error ? saveError.message : String(saveError);
            if (state.status === 'failed') throw new AggregateError([cleanupError, saveError], 'Workspace finalization and status persistence failed');
            throw saveError;
        }
        if (state.status === 'failed') throw cleanupError;
    })();
    void completion.catch(() => undefined);
    return { state, completion };
}
