/**
 * @file vfslib/src/utils/debug.ts
 * @desc Lightweight VFS event trace logger.
 *
 * Enable at runtime:
 *   localStorage.setItem('vfs:debug', '1')  →  refresh page
 *
 * Sections controlled by the key:
 *   bus      EventBus emit / handler count
 *   module   ModuleFS.on() filter pass / miss
 *   engine   VFSModuleEngine.on() subscription + callback
 *
 * Output format (all to console.debug):
 *   [vfs:bus]     emit node:created  moduleId=chat  → 2 handlers
 *   [vfs:module:chat]  on(node:created) filter ✓  (pass)
 *   [vfs:engine:chat]  subscribe node:batch_updated → fs:node:updated  ⚠ DUPLICATE FS EVENT
 *   [vfs:engine:chat]  callback node:created  {nodes:[{nodeId:'x'}]}
 */

const STORAGE_KEY = 'vfs:debug';

// Lazily-evaluated flag — works in browser and Node (test env has no localStorage)
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

// ── Bus ───────────────────────────────────────────────────────────────────────

export const busDEBUG = {
    /** Called inside EventBus.emit() */
    emit(
        type: string,
        handlerCount: number,
        extra: { moduleId?: string; fromTransaction?: boolean },
    ): void {
        if (!isEnabled()) return;
        const mod = extra.moduleId ? `moduleId=${extra.moduleId}` : 'moduleId=—';
        const tx = extra.fromTransaction ? ' [tx]' : '';
        console.debug(
            `%c[vfs:bus]%c emit ${type}${tx}  ${mod}  → ${handlerCount} handler(s)`,
            'color:#6366f1;font-weight:bold', 'color:inherit',
        );
    },

    /** Called inside EventBus.on() */
    on(type: string, totalHandlers: number): void {
        if (!isEnabled()) return;
        console.debug(
            `%c[vfs:bus]%c on(${type})  total=${totalHandlers} handler(s)`,
            'color:#6366f1;font-weight:bold', 'color:inherit',
        );
    },
};

// ── ModuleFS ──────────────────────────────────────────────────────────────────

export const moduleDEBUG = {
    /** Called when the moduleId filter inside ModuleFS.on() evaluates */
    filter(moduleId: string, type: string, pass: boolean, evtModuleId?: string): void {
        if (!isEnabled()) return;
        const mark = pass ? '✓' : '✗';
        const info = evtModuleId ? `evtModuleId=${evtModuleId}` : 'evtModuleId=—';
        console.debug(
            `%c[vfs:module:${moduleId}]%c on(${type}) filter ${mark}  ${info}`,
            'color:#10b981;font-weight:bold', 'color:inherit',
        );
    },
};

// ── VFSModuleEngine ───────────────────────────────────────────────────────────

/** Track which (moduleName, fsEvent) pairs already have an active subscription
 *  to detect duplicate FS subscriptions caused by batch→base event mapping. */
const _activeFsSubscriptions = new Map<string, number>(); // key → count

export const engineDEBUG = {
    /** Called when VFSModuleEngine.on() registers a handler. */
    subscribe(moduleName: string, engineEvent: string, fsEvent: string): void {
        if (!isEnabled()) return;
        const key = `${moduleName}|${fsEvent}`;
        const prev = _activeFsSubscriptions.get(key) ?? 0;
        _activeFsSubscriptions.set(key, prev + 1);
        const dupWarn = prev > 0
            ? ` %c⚠ DUPLICATE FS EVENT (count=${prev + 1})`
            : '';
        console.debug(
            `%c[vfs:engine:${moduleName}]%c subscribe ${engineEvent} → fs:${fsEvent}${dupWarn}`,
            'color:#f59e0b;font-weight:bold', 'color:inherit',
            prev > 0 ? 'color:#ef4444;font-weight:bold' : '',
        );
    },

    /** Called when VFSModuleEngine.on() unsubscribes. */
    unsubscribe(moduleName: string, fsEvent: string): void {
        const key = `${moduleName}|${fsEvent}`;
        const prev = _activeFsSubscriptions.get(key) ?? 0;
        if (prev > 0) _activeFsSubscriptions.set(key, prev - 1);
    },

    /** Called when a VFSModuleEngine callback is invoked. */
    callback(moduleName: string, engineEvent: string, payload: unknown): void {
        if (!isEnabled()) return;
        console.debug(
            `%c[vfs:engine:${moduleName}]%c callback ${engineEvent}`,
            'color:#f59e0b;font-weight:bold', 'color:inherit',
            payload,
        );
    },
};
