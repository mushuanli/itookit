// @file: llm-engine/core/harness-context.ts
//
// Lightweight service locator for harness runtime services.
// Replaces direct HarnessAdapter dependency in llm-ui, allowing the UI layer
// to access IAgentRuntime, ISkillService, and IToolService through a stable
// interface instead of the concrete adapter class.
//
// S6c: Introduced to decouple llm-ui from HarnessAdapter.

import type { IAgentRuntime, ISkillService, IToolService } from '@itookit/common';

export interface IHarnessContext {
    readonly runtime: IAgentRuntime;
    readonly skillService: ISkillService | null;
    readonly toolService: IToolService | null;
}

let context: IHarnessContext | null = null;

export function setHarnessContext(ctx: IHarnessContext | null): void {
    context = ctx;
}

export function getHarnessContext(): IHarnessContext | null {
    return context;
}
