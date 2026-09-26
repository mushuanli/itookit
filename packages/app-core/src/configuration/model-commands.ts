import { randomUUID, type ConnectionMeta, type IConnectionService, type LLMProvider } from '@itookit/common';
import { FSError } from '@itookit/vfs-core';

export interface ConfigurationStore extends Pick<IConnectionService, 'getProviders' | 'getConnections' | 'deleteProvider' | 'deleteConnection'> {
    deleteSystemPrompt(id: string): Promise<void>;
    deleteMCPServer(id: string): Promise<void>;
}
export interface ProviderDeletionImpact {
    revision: string;
    providers: LLMProvider[];
    connections: ConnectionMeta[];
}
export interface ConfigurationDeletionTarget { kind: 'providers' | 'connections' | 'mcp' | 'prompts'; ids: readonly string[] }
export class ConfigurationMutationError extends Error {
    constructor(readonly completed: readonly string[], cause: unknown) {
        super(`Configuration update incomplete; completed: ${completed.join(', ') || 'none'}. ${String(cause)}`, { cause });
    }
}

/** Cross-resource operations are shared by every host; UI only chooses a policy. */
export class ModelConfigurationCommands {
    private readonly plans = new Map<string, { ids: string[]; signature: string }>();
    private closed = false;
    private tail: Promise<unknown> = Promise.resolve();
    constructor(private readonly store: ConfigurationStore) {}
    private async impact(ids: readonly string[]): Promise<Omit<ProviderDeletionImpact, 'revision'>> {
        const providers = this.store.getProviders().filter(item => ids.includes(item.id));
        if (providers.length !== new Set(ids).size) throw new FSError('ENOENT', 'Provider not found');
        const all = await this.store.getConnections(), connections = all.filter(item => ids.includes(item.providerId));
        return { providers, connections };
    }
    async inspectProviderDeletion(ids: readonly string[]): Promise<ProviderDeletionImpact> {
        if (this.closed) throw new FSError('EBUSY', 'Configuration service is closed');
        const impact = await this.impact(ids), revision = randomUUID();
        this.plans.set(revision, { ids: [...new Set(ids)], signature: signature(impact) });
        return { ...impact, revision };
    }
    discardPlan(revision: string): void { this.plans.delete(revision); }
    deleteProviders(input: { revision: string }): Promise<void> {
        return this.serial(async () => {
            const plan = this.plans.get(input.revision);
            if (!plan) throw new FSError('EINVAL', 'Deletion preview expired');
            const impact = await this.impact(plan.ids);
            if (signature(impact) !== plan.signature) throw new FSError('EBUSY', 'Configuration changed; review deletion again');
            this.plans.delete(input.revision);
            await this.applyDeletion(impact);
        });
    }
    private async applyDeletion(impact: Omit<ProviderDeletionImpact, 'revision'>): Promise<void> {
        const completed: string[] = [];
        try {
            for (const item of impact.connections) { await this.store.deleteConnection(item.id); completed.push(`connection:${item.id}`); }
            for (const item of impact.providers) { await this.store.deleteProvider(item.id); completed.push(`provider:${item.id}`); }
        } catch (error) { throw new ConfigurationMutationError(completed, error); }
    }
    deleteResources(target: { kind: 'connections' | 'mcp' | 'prompts'; ids: readonly string[] }): Promise<void> {
        return this.serial(async () => {
            const completed: string[] = [];
            try {
                for (const id of new Set(target.ids)) {
                    if (target.kind === 'prompts') await this.store.deleteSystemPrompt(id);
                    else if (target.kind === 'connections') await this.store.deleteConnection(id); else await this.store.deleteMCPServer(id);
                    completed.push(`${target.kind}:${id}`);
                }
            } catch (error) { throw new ConfigurationMutationError(completed, error); }
        });
    }
    async dispose(): Promise<void> { this.closed = true; await this.tail; this.plans.clear(); }
    private serial(work: () => Promise<void>): Promise<void> {
        if (this.closed) return Promise.reject(new FSError('EBUSY', 'Configuration service is closed'));
        const result = this.tail.then(work); this.tail = result.catch(() => {}); return result;
    }
}
function signature(impact: Omit<ProviderDeletionImpact, 'revision'>): string {
    return JSON.stringify({ providers: impact.providers.map(item => item.id).sort(),
        connections: impact.connections.map(item => [item.id, item.providerId]).sort() });
}
