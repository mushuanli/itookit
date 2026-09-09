import type { Kernel } from '@itookit/durable-kernel';
import { DurableAgentProgram, DurableChatProgram, DurablePlanProgram } from '@itookit/llm-tasks';
import { FlowAggregateProgram, FlowHumanProgram, FlowValueProgram } from './programs';

/** Register the Durable programs shared by direct Chat, Agent and Flow execution. */
export function registerDurablePrograms(kernel: Pick<Kernel, 'programs' | 'registerProgram'>): void {
    const programs = [
        new DurableChatProgram(),
        new DurableAgentProgram(),
        new DurablePlanProgram(),
        new FlowValueProgram(),
        new FlowHumanProgram(),
        new FlowAggregateProgram(),
    ];
    for (const program of programs) {
        if (!kernel.programs.has(program.manifest.kind, program.manifest.version)) {
            kernel.registerProgram(program);
        }
    }
}
