import { FSError } from '@itookit/vfs-core';
import type { ExecutionBindingStore, ProjectExecutionBinding, ProjectExecutionProvider, ProjectExecutionTarget, ProjectExecutionSources } from './contracts';
import { validateExecutionTarget, executionGrantRevision, requireExecutionCapabilities, executionGrantChanged } from './policy';

/** Project policy validates current identity and grants before a host creates any process. */
export class ProjectExecutionService {
    constructor(private readonly store: ExecutionBindingStore, private readonly remote: ProjectExecutionSources,
        private readonly beforeChange: (projectId: string) => Promise<void>,
        private readonly afterChange: (projectId: string) => Promise<void>, private readonly provider?: ProjectExecutionProvider) {}
    async get(projectId: string) { return (await this.store.read(projectId)).binding; }
    async bind(projectId: string, target: ProjectExecutionTarget): Promise<void> {
        validateExecutionTarget(target);
        await this.beforeChange(projectId);
        const current = await this.store.read(projectId), mounts = this.remote.list(projectId);
        const revision = executionGrantRevision(mounts, target.connectionId);
        const capabilities = await this.remote.executionCapabilities(target.connectionId);
        const binding: ProjectExecutionBinding = { ...target, version: 2, mode: 'directory', authorizationRevision: revision };
        requireExecutionCapabilities(binding, capabilities, mounts);
        await this.beforeChange(projectId);
        if (executionGrantRevision(this.remote.list(projectId), target.connectionId) !== revision) throw executionGrantChanged();
        await this.store.write(projectId, current.raw, binding);
        await this.afterChange(projectId);
    }
    async clear(projectId: string): Promise<void> {
        await this.beforeChange(projectId);
        const current = await this.store.read(projectId);
        await this.store.write(projectId, current.raw, null);
        await this.afterChange(projectId);
    }
    async acquire(projectId: string, sessionId: string, scopeId?: string) {
        const current = await this.store.read(projectId);
        if (!current.binding) return undefined;
        const binding = current.binding;
        if (binding.version !== 2) throw new FSError('ECAPABILITY', 'Legacy copy execution requires explicit rebinding to directory execution');
        const mounts = this.remote.list(projectId);
        if (executionGrantRevision(mounts, binding.connectionId) !== binding.authorizationRevision) throw executionGrantChanged();
        requireExecutionCapabilities(binding, await this.remote.executionCapabilities(binding.connectionId), mounts);
        if (!this.provider) throw new FSError('ECAPABILITY', 'Remote execution provider is unavailable');
        const connection = this.remote.connection(binding.connectionId);
        const context = await this.provider.acquire({ projectId, sessionId, scopeId, binding, mounts, connection });
        try {
            if ((await this.store.read(projectId)).raw !== current.raw
                || executionGrantRevision(this.remote.list(projectId), binding.connectionId) !== binding.authorizationRevision) throw executionGrantChanged();
            if (!context.nativeShell) throw new FSError('ECAPABILITY', 'Remote workspace has no process driver');
            return context;
        } catch (error) {
            try { await context.release(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Remote workspace verification and cleanup failed'); }
            throw error;
        }
    }
}
