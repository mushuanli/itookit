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

  constructor(scopeId: string) {
    this.storageKey = `vfs_ui_state_${scopeId}`;
  }

  load(): Partial<VFSUIState> {
    try {
      const json = localStorage.getItem(this.storageKey);
      return json ? JSON.parse(json) : {};
    } catch {
      return {};
    }
  }

  connectAutoSave(store: IStatePort): () => void {
    this.unsubscribe = store.subscribe(state => {
      this.save(state);
    });
    return this.unsubscribe;
  }

  private save(state: VFSUIState): void {
    try {
      localStorage.setItem(
        this.storageKey,
        JSON.stringify({
          activeId: state.activeId,
          expandedFolderIds: [...state.expandedFolderIds],
          selectedItemIds: [...state.selectedItemIds],
          uiSettings: state.uiSettings,
          isSidebarCollapsed: state.isSidebarCollapsed,
        })
      );
    } catch (e) {
      console.error('[StatePersistence] Failed to save:', e);
    }
  }

  destroy(): void {
    this.unsubscribe?.();
  }
}
