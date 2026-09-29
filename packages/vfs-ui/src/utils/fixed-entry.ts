import type { VFSNodeUI } from '../contracts/types';
import { findNodeById } from './helpers';

/** Owner-managed navigation references do not participate in resource mutations. */
export function mutableEntryIds(items: VFSNodeUI[], ids: string[]): string[] {
    return ids.filter(id => findNodeById(items, id)?.metadata.custom._fixedEntry !== true);
}
