import type { MemoryPolicy } from '@itookit/common';
import type { AgentConfig } from './types';

/** Translate CLI field names without sharing mutable policy arrays with the workflow. */
export function memoryPolicyForAgent(agent: AgentConfig): MemoryPolicy | undefined {
    const policy = agent.memory_policy;
    if (!policy) return undefined;
    return {
        namespaceId: policy.namespace_id, readScopes: [...policy.read_scopes], writeScopes: [...policy.write_scopes],
        ...(policy.retrieval_limit !== undefined ? { retrievalLimit: policy.retrieval_limit } : {}),
        ...(policy.retention ? { retention: {
            ...(policy.retention.max_entries_per_scope !== undefined ? { maxEntriesPerScope: policy.retention.max_entries_per_scope } : {}),
            ...(policy.retention.before !== undefined ? { before: policy.retention.before } : {}),
        } } : {}),
    };
}
