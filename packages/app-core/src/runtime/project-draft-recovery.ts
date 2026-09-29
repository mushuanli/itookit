import type { SessionManager } from '@itookit/llm-session';
import type { ProjectDraftService } from '../projects/drafts/service';

/** Wire notifications and drain in-flight recovery before runtime storage is released. */
export async function attachProjectDraftRecovery(drafts: ProjectDraftService,
    sessions: Pick<SessionManager, 'onGlobalEvent'>): Promise<() => Promise<void>> {
    const pending = new Set<Promise<void>>();
    const unsubscribe = sessions.onGlobalEvent(event => {
        if (event.type !== 'execution_task_projected') return;
        const work = drafts.submitted(event.payload).catch(error => console.warn('Draft recovery deferred', error));
        pending.add(work); void work.finally(() => pending.delete(work));
    });
    try { await drafts.recover(); } catch (error) { unsubscribe(); await Promise.all(pending); throw error; }
    return async () => { unsubscribe(); await Promise.all(pending); };
}
