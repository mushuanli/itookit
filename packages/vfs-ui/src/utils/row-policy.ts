/**
 * @file vfs-ui/utils/row-policy.ts
 * @desc Single source of the per-row write policy.
 *
 * Components only render and dispatch; this module alone decides which rows
 * accept mutations, which rows get the inline delete control, and which rows
 * delegate deletion to the host. Keeping the rules here stops the renderer,
 * the context menu, drag & drop and the row handlers from drifting apart.
 */
import type { VFSNodeUI } from '../contracts/types';
import { isItemReadOnly } from './helpers';

/** Data attributes published by item rendering and consumed by drag & drop gating. */
export const ROW_FLAGS = { readOnly: 'readOnly', fixed: 'fixedEntry' } as const;

export interface RowPolicy {
  /** The row rejects every mutation (view-wide or per-item read-only). */
  readOnly: boolean;
  /** Host-owned navigation entry excluded from resource mutations. */
  fixed: boolean;
  /** Render the inline two-step delete control. */
  inlineDelete: boolean;
  /**
   * A virtual entry owns deletion through `onQuickDelete` because `file:delete`
   * cannot resolve it (session rows, remote references).
   */
  hostOwnedDelete: boolean;
}

/**
 * Resolve the interaction policy for one rendered row.
 *
 * Files always get the inline delete control; virtual entries opt in through
 * `presentation.quickDelete`, which also hands deletion to the host.
 */
export const resolveRowPolicy = (viewReadOnly: boolean, node: VFSNodeUI): RowPolicy => {
  const fixed = node.metadata.custom._fixedEntry === true;
  const readOnly = viewReadOnly || isItemReadOnly(node);
  const declared = node.type === 'file' || node.presentation?.quickDelete === true;
  const inlineDelete = declared && !readOnly && !fixed;
  return { readOnly, fixed, inlineDelete, hostOwnedDelete: inlineDelete && node.presentation?.quickDelete === true };
};

/**
 * A read-only column root makes the whole column read-only, which also covers
 * the entries below it (offline mounts, generated history trees).
 */
export const resolveColumnReadOnly = (viewReadOnly: boolean, root: VFSNodeUI | undefined): boolean =>
  viewReadOnly || (!!root && isItemReadOnly(root));

const WRITE_ACTIONS = new Set(['create-in-folder-session', 'create-in-folder-folder', 'duplicate', 'edit-tags', 'rename', 'moveTo', 'delete']);
const ENTRY_ACTIONS = new Set(['rename', 'moveTo', 'delete']);
const BULK_ACTIONS: Record<string, string> = { 'bulk-delete': 'delete', 'bulk-move': 'moveTo', 'bulk-edit-tags': 'edit-tags' };

/** Host menus may customize presentation, but cannot re-enable a blocked built-in mutation. */
export function allowsRowAction(action: string, viewReadOnly: boolean, node: VFSNodeUI): boolean {
  const policy = resolveRowPolicy(viewReadOnly, node);
  const mutation = BULK_ACTIONS[action] ?? action;
  if (WRITE_ACTIONS.has(mutation) && (policy.readOnly || node.kind === 'group')) return false;
  return !(ENTRY_ACTIONS.has(mutation) && policy.fixed);
}
