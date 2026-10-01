import type { ICommandPort } from '../../../../contracts/ports';
import type { VFSNodeUI } from '../../../../contracts/types';
import type { VFSRowActionOptions } from '../../../../contracts/options';
import type { ActionRunner } from '../../../../interaction/ActionRunner';
import { resolveRowPolicy } from '../../../../utils/row-policy';

interface RowMutationContext {
    commands: ICommandPort;
    actions: ActionRunner;
    find(id: string): VFSNodeUI | null;
    readOnly(): boolean;
    sorted: boolean;
    onQuickDelete?: VFSRowActionOptions['onQuickDelete'];
    allows(action: string, node: VFSNodeUI): boolean;
}

/** Resolve current nodes at dispatch time; DOM flags are presentation, not authority. */
export function createRowMutationPort(context: RowMutationContext): ICommandPort {
    return { execute: (command, payload) => {
        if (command === 'file:delete') return deleteRow(context, payload as { itemIds: string[] });
        if (command === 'file:move') return moveRows(context, payload as MoveRequest);
        return context.commands.execute(command, payload);
    } };
}

type MoveRequest = import('../../../../contracts/commands').CommandMap['file:move'];

function deleteRow(context: RowMutationContext, payload: { itemIds: string[] }): Promise<void> | void {
    if (payload.itemIds.length !== 1) return;
    const node = context.find(payload.itemIds[0]);
    if (!node) return;
    const policy = resolveRowPolicy(context.readOnly(), node);
    if (!policy.inlineDelete) return;
    // The row's own control is the confirmation: its first click arms, the second one
    // runs. Re-entering the context-menu action here would ask the very same question
    // again, so the click goes straight to the deletion pipeline. Menu availability
    // still gates ordinary files; host-owned entries carry their policy through
    // `onQuickDelete` instead.
    if (!policy.hostOwnedDelete && !context.allows('delete', node)) return;
    return context.actions.run(`delete:${node.id}`, async () => {
        const current = context.find(node.id);
        if (!current) return;
        const currentPolicy = resolveRowPolicy(context.readOnly(), current);
        if (!currentPolicy.inlineDelete) return;
        if (currentPolicy.hostOwnedDelete && context.onQuickDelete) await context.onQuickDelete(current);
        else await context.commands.execute('file:delete', { itemIds: [current.id] });
    });
}

function moveRows(context: RowMutationContext, payload: MoveRequest): Promise<void> {
    return context.actions.run('move', async () => {
        const target = context.find(payload.targetId ?? '');
        if (!target || resolveRowPolicy(context.readOnly(), target).readOnly || target.kind === 'group') return;
        if (context.sorted && payload.position !== 'into') return;
        if (!payload.itemIds.length || !payload.itemIds.every(id => {
            const node = context.find(id);
            return !!node && context.allows('moveTo', node);
        })) return;
        await context.commands.execute('file:move', payload);
    });
}
