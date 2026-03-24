/**
 * @file vfs-ui/src/utils/adapter-debug.ts
 * @desc Debug trace for EngineAdapter — event receipt → queue → dispatch.
 *
 * Enable at runtime (same key as vfslib):
 *   localStorage.setItem('vfs:debug', '1')  →  refresh page
 *
 * Expected output:
 *   [adapter] ← node:created  {nodes:[{nodeId:'abc',path:'/chat.chat'}]}
 *   [adapter] queue create  add abc  (size=1)
 *   [adapter] queue update  add abc  (size=1)   ← DUPLICATE if both updated/batch_updated fire
 *   [adapter] process create  ['abc']
 *   [adapter] getNode abc  → chat.chat [file]
 *   [adapter] → SESSION_CREATE_SUCCESS  id=abc
 *   [adapter] process update  ['abc']
 *   [adapter] getNode abc  → chat.chat [file]
 *   [adapter] → ITEMS_BATCH_UPDATE_SUCCESS  [abc]
 */

const STORAGE_KEY = 'vfs:debug';
let _enabled: boolean | null = null;

function isEnabled(): boolean {
    if (_enabled !== null) return _enabled;
    try {
        _enabled = typeof localStorage !== 'undefined'
            ? localStorage.getItem(STORAGE_KEY) === '1'
            : false;
    } catch {
        _enabled = false;
    }
    return _enabled;
}

export const adapterDEBUG = {
    /** Raw event received from engine.on() */
    received(type: string, payload: unknown): void {
        if (!isEnabled()) return;
        console.debug(
            `%c[adapter]%c ← ${type}`,
            'color:#8b5cf6;font-weight:bold', 'color:inherit',
            payload,
        );
    },

    /** A nodeId is added to a queue */
    queued(action: 'create' | 'update' | 'delete', nodeId: string, queueSize: number): void {
        if (!isEnabled()) return;
        console.debug(
            `%c[adapter]%c queue ${action}  add ${nodeId}  (size=${queueSize})`,
            'color:#8b5cf6;font-weight:bold', 'color:inherit',
        );
    },

    /** Queue processing started */
    processing(action: 'create' | 'update' | 'delete', ids: string[]): void {
        if (!isEnabled()) return;
        console.debug(
            `%c[adapter]%c process ${action}  [${ids.join(', ')}]`,
            'color:#8b5cf6;font-weight:bold', 'color:inherit',
        );
    },

    /** getNode result */
    nodeResult(id: string, node: { name: string; type: string } | null): void {
        if (!isEnabled()) return;
        const desc = node ? `${node.name} [${node.type}]` : 'null (not found)';
        console.debug(
            `%c[adapter]%c getNode ${id}  → ${desc}`,
            'color:#8b5cf6;font-weight:bold', 'color:inherit',
        );
    },

    /** VFSStore dispatch */
    dispatch(action: string, detail: string): void {
        if (!isEnabled()) return;
        console.debug(
            `%c[adapter]%c → ${action}  ${detail}`,
            'color:#8b5cf6;font-weight:bold', 'color:#16a34a;font-weight:bold',
        );
    },

    /** loadData called */
    loadData(trigger: string): void {
        if (!isEnabled()) return;
        console.debug(
            `%c[adapter]%c loadData() triggered by ${trigger}`,
            'color:#8b5cf6;font-weight:bold', 'color:inherit',
        );
    },
};
