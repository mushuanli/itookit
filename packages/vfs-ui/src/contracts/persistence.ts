/**
 * @file vfs-ui/contracts/persistence.ts
 * @desc Storage-agnostic UI snapshot and the port hosts use to keep it.
 *
 * The package never writes host storage on its own: a browser owns presentation
 * state, not where it lives. Hosts either pass a port (VFS, Tauri store) or opt
 * into the bundled localStorage adapter; without one nothing is persisted.
 */
import type { UISettings, VFSUIState } from './types';

export const UI_STATE_VERSION = 1;

/**
 * Versioned presentation state worth restoring on the next launch. Loaded items,
 * tags and status are caches rebuilt from the source and are never persisted.
 */
export interface UISnapshot {
    version: 1;
    activeId: string | null;
    expandedFolderIds: string[];
    selectedItemIds: string[];
    uiSettings: UISettings;
    isSidebarCollapsed: boolean;
}

/**
 * What a port may hand back: every field is optional and `uiSettings` may be
 * partial, because the store merges it over the defaults.
 */
export interface RestoredUISnapshot {
    version?: number;
    activeId?: string | null;
    expandedFolderIds?: string[];
    selectedItemIds?: string[];
    uiSettings?: Partial<UISettings>;
    isSidebarCollapsed?: boolean;
}

/**
 * Host-owned storage for {@link UISnapshot}.
 *
 * `load` is synchronous because a browser restores while it is being constructed.
 * Hosts whose storage is async (VFS reads, Tauri store) must read once beforehand
 * and answer from that cache.
 */
export interface UIPersistencePort {
    /** Snapshot to restore, or `undefined` when there is nothing usable. */
    load?(): RestoredUISnapshot | undefined;
    /** Persist a snapshot; called after the state actually changed. */
    save(snapshot: UISnapshot): void;
    /** Release storage resources. Pending writes should already be queued by `save`. */
    destroy?(): void;
}

/** Project the internal state onto the persistable snapshot. */
export function uiSnapshot(state: VFSUIState): UISnapshot {
    return { version: UI_STATE_VERSION, activeId: state.activeId,
        expandedFolderIds: [...state.expandedFolderIds], selectedItemIds: [...state.selectedItemIds],
        uiSettings: state.uiSettings, isSidebarCollapsed: state.isSidebarCollapsed };
}

const stringList = (value: unknown): string[] | undefined =>
    Array.isArray(value) && value.every(item => typeof item === 'string') ? value as string[] : undefined;

/**
 * Validate an untrusted snapshot. Unknown versions and malformed fields are
 * discarded rather than half-applied, so a corrupt record costs the restore, not
 * the launch.
 */
export function readUISnapshot(value: unknown): RestoredUISnapshot | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    const source = record.state && typeof record.state === 'object' ? record.state as Record<string, unknown> : record;
    if (source.version !== undefined && source.version !== UI_STATE_VERSION) return undefined;
    const activeId = source.activeId;
    if (activeId !== undefined && activeId !== null && typeof activeId !== 'string') return undefined;
    const expandedFolderIds = stringList(source.expandedFolderIds);
    if (source.expandedFolderIds !== undefined && !expandedFolderIds) return undefined;
    const selectedItemIds = stringList(source.selectedItemIds);
    if (source.selectedItemIds !== undefined && !selectedItemIds) return undefined;
    const uiSettings = source.uiSettings && typeof source.uiSettings === 'object' ? source.uiSettings as Partial<UISettings> : undefined;
    if (source.uiSettings !== undefined && !uiSettings) return undefined;
    const isSidebarCollapsed = typeof source.isSidebarCollapsed === 'boolean' ? source.isSidebarCollapsed : undefined;
    return { version: UI_STATE_VERSION, ...(typeof activeId === 'string' ? { activeId } : {}),
        ...(expandedFolderIds ? { expandedFolderIds } : {}), ...(selectedItemIds ? { selectedItemIds } : {}),
        ...(uiSettings ? { uiSettings } : {}), ...(isSidebarCollapsed === undefined ? {} : { isSidebarCollapsed }) };
}

/**
 * Opt-in adapter for hosts whose only storage is the webview's localStorage.
 * Desktop hosts should persist through their VFS instead.
 */
export function createLocalStorageUIPersistence(scopeId: string): UIPersistencePort {
    const storageKey = `vfs_ui_state_${scopeId}`;
    return {
        load: () => {
            try { return readUISnapshot(JSON.parse(localStorage.getItem(storageKey) ?? 'null')); }
            catch { return undefined; }
        },
        save: snapshot => { localStorage.setItem(storageKey, JSON.stringify(snapshot)); },
    };
}
