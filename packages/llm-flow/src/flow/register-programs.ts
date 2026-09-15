import type { Kernel } from '@itookit/durable-kernel';
import { DurableAgentProgram, DurableChatProgram, DurablePlanProgram } from '@itookit/llm-tasks';
import { FlowAggregateProgram, FlowHumanProgram, FlowValueProgram } from './programs';
import { FlowInputProgram } from './structured/input';
import type { FlowReducerRegistry } from './structured/join';
import { FlowDispatchProgram } from './structured/dispatch';

/** Register the Durable programs shared by direct Chat, Agent and Flow execution. */
export function registerDurablePrograms(kernel: Pick<Kernel, 'programs' | 'registerProgram'>, reducers?: FlowReducerRegistry): void {
    const programs = [
        new DurableChatProgram(),
        new DurableAgentProgram(),
        new DurablePlanProgram(),
        new FlowValueProgram(),
        new FlowHumanProgram(),
        new FlowAggregateProgram(),
        new FlowInputProgram(),
        new FlowDispatchProgram(reducers),
    ];
    for (const program of programs) {
        if (!kernel.programs.has(program.manifest.kind, program.manifest.version)) {
            kernel.registerProgram(program);
        }
    }
}
