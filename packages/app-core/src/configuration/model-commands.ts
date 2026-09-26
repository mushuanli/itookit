import { randomUUID, t, type AgentDefinition, type ConnectionMeta, type IConnectionService, type LLMProvider } from '@itookit/common';
import { FSError } from '@itookit/vfs-core';

export interface ConfigurationStore extends Pick<IConnectionService, 'getProviders' | 'getConnections' | 'deleteProvider' | 'deleteConnection'> {
    getAgents(): Promise<AgentDefinition[]>;
    saveAgent(agent: AgentDefinition): Promise<void>;
    deleteAgent(id: string): Promise<void>;
    deleteMCPServer(id: string): Promise<void>;
}
export type AgentDeletionChoice = { mode: 'keep' } | { mode: 'delete' } | { mode: 'replace'; connectionId: string };
export interface ProviderDeletionImpact {
    revision: string;
    providers: LLMProvider[];
    connections: ConnectionMeta[];
    agents: AgentDefinition[];
    replacements: ConnectionMeta[];
}
export interface ConfigurationDeletionTarget { kind: 'providers' | 'connections' | 'mcp'; ids: readonly string[] }
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
        const removed = new Set(connections.map(item => item.id));
        return { providers, connections, agents: (await this.store.getAgents()).filter(item => removed.has(item.config.connectionId)),
            replacements: all.filter(item => !removed.has(item.id)) };
    }
    async inspectProviderDeletion(ids: readonly string[]): Promise<ProviderDeletionImpact> {
        if (this.closed) throw new FSError('EBUSY', 'Configuration service is closed');
        const impact = await this.impact(ids), revision = randomUUID();
        this.plans.set(revision, { ids: [...new Set(ids)], signature: signature(impact) });
        return { ...impact, revision };
    }
    discardPlan(revision: string): void { this.plans.delete(revision); }
    deleteProviders(input: { revision: string; agents: AgentDeletionChoice }): Promise<void> {
        return this.serial(async () => {
            const plan = this.plans.get(input.revision);
            if (!plan) throw new FSError('EINVAL', 'Deletion preview expired');
            const impact = await this.impact(plan.ids);
            if (signature(impact) !== plan.signature) throw new FSError('EBUSY', 'Configuration changed; review deletion again');
            if (impact.connections.some(item => item.id === 'default')) throw new FSError('EACCES', t('toolbox.defaultProviderInUse'));
            const choice = input.agents;
            if (choice.mode === 'replace' && !impact.replacements.some(item => item.id === choice.connectionId))
                throw new FSError('EINVAL', 'Replacement connection is no longer available');
            this.plans.delete(input.revision);
            await this.applyDeletion(impact, choice);
        });
    }
    private async applyDeletion(impact: Omit<ProviderDeletionImpact, 'revision'>, choice: AgentDeletionChoice): Promise<void> {
        const completed: string[] = [];
        try {
            for (const agent of impact.agents) {
                if (choice.mode === 'keep') continue;
                if (choice.mode === 'delete') await this.store.deleteAgent(agent.id);
                else await this.store.saveAgent({ ...agent, config: { ...agent.config, connectionId: choice.connectionId } });
                completed.push(`agent:${agent.id}`);
            }
            for (const item of impact.connections) { await this.store.deleteConnection(item.id); completed.push(`connection:${item.id}`); }
            for (const item of impact.providers) { await this.store.deleteProvider(item.id); completed.push(`provider:${item.id}`); }
        } catch (error) { throw new ConfigurationMutationError(completed, error); }
    }
    deleteResources(target: { kind: 'connections' | 'mcp'; ids: readonly string[] }): Promise<void> {
        return this.serial(async () => {
            if (target.kind === 'connections' && target.ids.includes('default')) throw new FSError('EACCES', 'Cannot delete the default connection');
            const completed: string[] = [];
            try {
                for (const id of new Set(target.ids)) {
                    if (target.kind === 'connections') await this.store.deleteConnection(id); else await this.store.deleteMCPServer(id);
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
        connections: impact.connections.map(item => [item.id, item.providerId]).sort(),
        agents: impact.agents.map(item => [item.id, item.config.connectionId]).sort(),
        replacements: impact.replacements.map(item => [item.id, item.providerId]).sort() });
}
