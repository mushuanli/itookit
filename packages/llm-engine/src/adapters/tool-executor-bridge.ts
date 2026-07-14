// @file: llm-engine/adapters/tool-executor-bridge.ts
//
// Adapts IToolService (from @itookit/tools) to IToolExecutor (from llm-engine agent-loop-strategy).
// This bridge allows ILoop-based executors to use the full tools package.

import type { IToolService, ToolMeta } from '@itookit/common';
import type { IToolExecutor } from '../session/agent-loop-strategy';

export class ToolServiceToExecutorAdapter implements IToolExecutor {
    constructor(
        private readonly toolService: IToolService,
        private readonly cwd?: string,
    ) {}

    async execute(name: string, input: Record<string, unknown>): Promise<string> {
        const result = await this.toolService.invoke({
            toolId: name,
            args: input,
            cwd: this.cwd ?? '/',
        });

        if (!result.success) {
            throw new Error(result.error ?? `Tool "${name}" failed`);
        }

        return result.output;
    }

    getMeta(name: string): { sideEffect: 'none' | 'local' | 'external' } | undefined {
        const meta: ToolMeta | undefined = this.toolService.getToolMeta(name);
        if (!meta) return undefined;
        return { sideEffect: meta.sideEffect };
    }
}
