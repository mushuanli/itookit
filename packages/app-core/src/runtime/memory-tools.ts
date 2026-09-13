import type { Kernel } from '@itookit/durable-kernel';
import type { KernelAdaptersRuntimeOptions } from '@itookit/kernel-adapters';
import { TaskMemoryService } from '@itookit/llm-session';

/** Advertise metadata globally; execution resolves authority from the current persisted Task. */
export function createMemoryTools(kernel: () => Kernel): NonNullable<KernelAdaptersRuntimeOptions['effectTools']> {
    return ['memory_list', 'memory_write', 'memory_remove'].map(id => {
        const description = id === 'memory_list' ? 'List memories in the current task readable scopes.'
            : id === 'memory_write' ? 'Create or update a memory in a task-authorized scope.' : 'Remove a memory from a task-authorized scope.';
        const properties = id === 'memory_list' ? {} : {
            scope: { type: 'string', description: 'Exact authorized scope name.' },
            entryId: { type: 'string', description: 'Stable memory entry identifier.' },
            ...(id === 'memory_write' ? { content: { type: 'string' } } : {}),
            expectedContentHash: { type: ['string', 'null'], description: 'Previous content hash; null requires absence. Omit for unconditional mutation.' },
        };
        return {
            meta: { id, name: id, description, sideEffect: id === 'memory_list' ? 'none' : 'local',
                timeoutMs: 30_000, type: 'builtin', enabled: true },
            definition: { type: 'function', function: { name: id, description, parameters: { type: 'object',
                properties, additionalProperties: false, required: id === 'memory_list' ? []
                    : ['scope', 'entryId', ...(id === 'memory_write' ? ['content'] : [])] } } },
            invoke: (args, context) => new TaskMemoryService(kernel()).invoke(id, args, context),
        };
    });
}
