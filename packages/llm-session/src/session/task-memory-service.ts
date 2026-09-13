import type { Kernel, EffectExecutionContext } from '@itookit/durable-kernel';
import type { DurableAgentInput } from '@itookit/llm-tasks';
import { SessionMemoryProvider } from './session-memory-provider';

/** Called only by a host Effect adapter with Kernel-owned execution identity. */
export class TaskMemoryService {
    private readonly memory: SessionMemoryProvider;
    constructor(private readonly kernel: Kernel) { this.memory = new SessionMemoryProvider(kernel); }

    async invoke(toolId: string, args: Record<string, unknown>,
        context: Pick<EffectExecutionContext, 'sessionId' | 'taskId' | 'abortSignal'>): Promise<string> {
        args = structuredClone(args);
        context.abortSignal.throwIfAborted();
        if (!['memory_list', 'memory_write', 'memory_remove'].includes(toolId)) throw new Error('Unknown memory tool');
        const task = await this.kernel.task(context.sessionId, context.taskId);
        const input = task.input as unknown as DurableAgentInput;
        if (task.program.kind !== 'llm.agent' || !input.memoryPolicy || !input.allowedToolIds?.includes(toolId)) {
            throw new Error('Task memory capability denied');
        }
        if (['succeeded', 'failed', 'cancelled'].includes(task.status)) throw new Error('Task has already ended');
        context.abortSignal.throwIfAborted();
        if (toolId === 'memory_list') return JSON.stringify(await this.memory.list(context.sessionId, input.memoryPolicy));
        const scope = argument(args, 'scope'), entryId = argument(args, 'entryId');
        const options = { expectedContentHash: args.expectedContentHash as string | null | undefined };
        if (toolId === 'memory_write') await this.memory.upsert(context.sessionId, input.memoryPolicy,
            { scope, entryId, content: argument(args, 'content') }, options);
        else await this.memory.remove(context.sessionId, input.memoryPolicy, scope, entryId, options);
        return JSON.stringify({ success: true });
    }
}

function argument(args: Record<string, unknown>, key: string): string {
    if (typeof args[key] !== 'string') throw new Error(`Memory ${key} must be a string`);
    return args[key];
}
