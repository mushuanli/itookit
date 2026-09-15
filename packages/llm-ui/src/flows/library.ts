/// <reference path="./flow-files.d.ts" />
import type { FlowDraft, ICommandBus } from '@itookit/common';
import { FlowCommand } from '@itookit/llm-session';
import essayReview from './library/essay-review-isolated.flow?raw';

/** Bundled definitions are copied once into the editable host Flow directory. */
export const builtinFlowLibrary: readonly FlowDraft[] = [JSON.parse(essayReview) as FlowDraft];

export async function installFlowLibrary(commands: ICommandBus, library = builtinFlowLibrary): Promise<void> {
    for (const template of library) await commands.execute(FlowCommand.DraftInstall, template);
}

/** Explicit user action; restore only missing files and retain installation receipts. */
export async function restoreFlowLibrary(commands: ICommandBus, library = builtinFlowLibrary): Promise<number> {
    let restored = 0;
    for (const template of library) if (await commands.execute<FlowDraft | null>(FlowCommand.DraftRestore, template)) restored++;
    return restored;
}
