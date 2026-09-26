/**
 * @file vfs-ui/services/StatePersistence.ts
 * @desc Handles persisting and restoring UI state to/from localStorage.
 *       Extracted from VFSUIShell to follow SRP.
 */
import type { IStatePort } from '../contracts/ports';
import type { VFSUIState } from '../contracts/types';

export class StatePersistence {
  private readonly storageKey: string;
  private unsubscribe: (() => void) | null = null;

  private previous = '';
  constructor(scopeId: string, private readonly enabled = true) {
    this.storageKey = `vfs_ui_state_${scopeId}`;
  }

  load(): Partial<VFSUIState> {
    if (!this.enabled) return {};
    try {
      const json = localStorage.getItem(this.storageKey);
      const parsed = json ? JSON.parse(json) : {};
      return parsed.version === undefined ? parsed : parsed.version === 1 ? parsed.state : {};
    } catch {
      return {};
    }
  }

  connectAutoSave(store: IStatePort): () => void {
    if (!this.enabled) return () => {};
    this.unsubscribe = store.subscribe(state => {
      this.save(state);
    });
    return this.unsubscribe;
  }

  private save(state: VFSUIState): void {
    try {
      const json = JSON.stringify({ version: 1, state: {
        activeId: state.activeId, expandedFolderIds: [...state.expandedFolderIds],
        selectedItemIds: [...state.selectedItemIds], uiSettings: state.uiSettings,
        isSidebarCollapsed: state.isSidebarCollapsed,
      } });
      if (json !== this.previous) { localStorage.setItem(this.storageKey, json); this.previous = json; }
    } catch (e) {
      console.error('[StatePersistence] Failed to save:', e);
    }
  }

  destroy(): void {
    this.unsubscribe?.();
  }
}
