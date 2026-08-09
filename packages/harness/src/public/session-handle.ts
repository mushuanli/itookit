import type { Harness } from '../application/harness';
import type {
    BudgetAccount,
    ContextBranch,
    ContextCommit,
    ContextCommitOptions,
    CrossSessionMessage,
    EventEnvelope,
    InteractionResponse,
    JsonValue,
    ProgramRef,
    ResourceGrant,
    ResourceHandle,
    ResourceRecord,
    ResourceRight,
    ResourceSpec,
    SessionHandle,
    SharedStateEntry,
    SharedStateRevision,
    SharedStateWriteOptions,
    TaskHandle,
    TaskSignal,
    TaskSpec,
    WorkspaceDiff,
    WorkspaceMergeResult,
    WorkspaceSnapshot,
} from '../domain/types';
import { eventStream } from './event-stream';

export class DefaultSessionHandle implements SessionHandle {
    constructor(private readonly kernel: Harness, readonly id: string) {}

    submit<I, O = unknown>(spec: TaskSpec<I>): Promise<TaskHandle<O>> {
        return this.kernel.submit<I, O>(this.id, spec);
    }

    signal(taskId: string, signal: TaskSignal): Promise<void> {
        return this.kernel.signal(this.id, taskId, signal);
    }

    respond<T extends JsonValue>(taskId: string, response: InteractionResponse<T>): Promise<void> {
        return this.kernel.respondInteraction(this.id, taskId, response);
    }

    events(options?: { after?: number }): AsyncIterable<EventEnvelope> {
        return eventStream(this.kernel, this.id, undefined, options?.after ?? 0);
    }

    getShared<T extends JsonValue>(key: string): Promise<SharedStateEntry<T> | undefined> {
        return this.kernel.getShared<T>(this.id, key);
    }

    setShared<T extends JsonValue>(
        key: string, value: T, options?: SharedStateWriteOptions,
    ): Promise<SharedStateEntry<T>> {
        return this.kernel.setShared(this.id, key, value, options);
    }

    deleteShared(key: string, options?: SharedStateWriteOptions): Promise<boolean> {
        return this.kernel.deleteShared(this.id, key, options);
    }

    listShared(prefix?: string): Promise<SharedStateEntry[]> {
        return this.kernel.listShared(this.id, prefix);
    }

    sharedHistory<T extends JsonValue>(key: string): Promise<SharedStateRevision<T>[]> {
        return this.kernel.sharedHistory(this.id, key);
    }

    send<T extends JsonValue>(target: string, topic: string, payload: T): Promise<CrossSessionMessage<T>> {
        return this.kernel.sendCrossSession(this.id, target, topic, payload);
    }

    inbox(options?: { after?: number }): Promise<CrossSessionMessage[]> {
        return this.kernel.inbox(this.id, options?.after ?? 0);
    }

    commitContext<T extends JsonValue>(delta: T, options?: ContextCommitOptions): Promise<ContextCommit<T>> {
        return this.kernel.commitContext(this.id, delta, options);
    }

    getContextCommit<T extends JsonValue>(id: string): Promise<ContextCommit<T> | undefined> {
        return this.kernel.getContextCommit<T>(this.id, id);
    }

    getContextBranch(name?: string): Promise<ContextBranch> {
        return this.kernel.getContextBranch(this.id, name);
    }

    contextHistory(head?: string): Promise<ContextCommit[]> {
        return this.kernel.contextHistory(this.id, head);
    }

    createResource(spec: ResourceSpec): Promise<ResourceGrant> {
        return this.kernel.createResource(this.id, spec);
    }

    grantResource(parent: string, holder: string, rights: ResourceRight[]): Promise<ResourceHandle> {
        return this.kernel.grantResource(this.id, parent, holder, rights);
    }

    revokeResource(handleId: string): Promise<number> {
        return this.kernel.revokeResource(this.id, handleId);
    }

    authorizeResource(handleId: string, right: ResourceRight, holder?: string): Promise<ResourceRecord> {
        return this.kernel.authorizeResource(this.id, handleId, right, holder);
    }

    setBudget(
        handleId: string, dimension: string, limit: number, version?: number | null,
    ): Promise<BudgetAccount> {
        return this.kernel.setBudget(this.id, handleId, dimension, limit, version);
    }

    chargeBudget(handleId: string, dimension: string, amount: number): Promise<BudgetAccount[]> {
        return this.kernel.chargeBudget(this.id, handleId, dimension, amount);
    }

    snapshotWorkspace(handleId: string, adapter: ProgramRef): Promise<WorkspaceSnapshot> {
        return this.kernel.snapshotWorkspace(this.id, handleId, adapter);
    }

    diffWorkspace(handleId: string, base: string, target: string): Promise<WorkspaceDiff> {
        return this.kernel.diffWorkspace(this.id, handleId, base, target);
    }

    mergeWorkspace(handleId: string, base: string, left: string, right: string): Promise<WorkspaceMergeResult> {
        return this.kernel.mergeWorkspace(this.id, handleId, base, left, right);
    }

    suspend(): Promise<void> { return this.kernel.setSessionStatus(this.id, 'suspended'); }
    resume(): Promise<void> { return this.kernel.setSessionStatus(this.id, 'open'); }
    close(options?: { cancelRunning?: boolean }): Promise<void> {
        return this.kernel.closeSession(this.id, options?.cancelRunning ?? false);
    }
}
