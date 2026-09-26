/**
 * @file vfs-ui/utils/delete-guard.ts
 * @desc Splits delete requests into entries the backend accepts and read-only ones.
 *
 * The session browser marks Task history entries read-only; the backend rejects them
 * with EROFS. Filtering here keeps bulk delete from failing as a whole.
 */
import type { VFSNodeUI } from '../contracts/types';
import { findNodeById, isItemReadOnly } from './helpers';

export function partitionDeletable(
    items: VFSNodeUI[],
    itemIds: string[],
): { deletable: string[]; blocked: string[] } {
    const deletable: string[] = [];
    const blocked: string[] = [];
    for (const id of itemIds) {
        const item = findNodeById(items, id);
        if (item && (item.kind === 'group' || isItemReadOnly(item))) blocked.push(id);
        else deletable.push(id);
    }
    return { deletable, blocked };
}

export const READ_ONLY_DELETE_MESSAGE = '所选条目为只读，无法删除';
