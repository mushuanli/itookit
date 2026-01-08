/**
 * @file vfs-ui/integrations/editor-connector.ts
 * @desc Provides a high-level function to connect a VFS-UI manager with any IEditor-compatible editor.
 *       Optimized with debounce saving and async initialization, guarded against race conditions.
 */
import type {
    IEditor, EditorFactory, EditorOptions, ISessionUI, ISessionEngine,
    EditorHostContext, NavigationRequest
} from '@itookit/common';
import type { VFSNodeUI, VFSUIState } from '../types/types';
import type { VFSService } from '../services/VFSService';
import { parseFileInfo, extractTaskCounts } from '../utils/parser';

export interface ConnectOptions {
    /** Callback fired when an editor instance is fully created and mounted */
    onEditorCreated?: (editor: IEditor | null) => void;
    /** Time in ms to wait before auto-saving after the last keystroke. Default: 500ms */
    saveDebounceMs?: number;
    /** Any extra options to pass to the editor factory (including hostContext from upstream) */
    [key: string]: any;
}

type VFSManager = ISessionUI<VFSNodeUI, VFSService> & {
  resolveEditorFactory?: (node: VFSNodeUI) => EditorFactory;
  store?: { getState(): VFSUIState; dispatch(action: any): void };
};

/**
 * Connects a session manager to an editor.
 * 
 * [Updated] Now supports dynamic editor factory resolution via vfsManager.
 */
export function connectEditorLifecycle(
  vfsManager: VFSManager,
  engine: ISessionEngine,
  editorContainer: HTMLElement,
  defaultEditorFactory?: EditorFactory,
  options: ConnectOptions = {}
): () => void {
  const { onEditorCreated, saveDebounceMs = 500, ...factoryExtraOptions } = options;

  let activeEditor: IEditor | null = null;
  let activeNode: VFSNodeUI | null = null;
  let unsubscribers: Array<() => void> = [];
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let sessionToken = 0;
  let lastTaskStats: { total: number; completed: number } | null = null;
  let hasUnsavedChanges = false;

  const dispatch = (itemId: string, metadata: any) => {
    vfsManager.store?.dispatch({ type: 'ITEM_METADATA_UPDATE', payload: { itemId, metadata } });
  };

  const optimisticUpdate = () => {
    if (!activeEditor || !activeNode) return;
    const stats = extractTaskCounts(activeEditor.getText());
    const current = lastTaskStats || activeNode.metadata.custom.taskCount || { total: 0, completed: 0 };

    if (stats.total !== current.total || stats.completed !== current.completed) {
      lastTaskStats = stats;
      hasUnsavedChanges = true;
      dispatch(activeNode.id, { custom: { ...activeNode.metadata.custom, taskCount: stats } });
    }
  };

    /**
     * 执行保存 (DB Write)
     */
  const save = async () => {
    if (!activeEditor || !activeNode) return;
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (!activeEditor.isDirty?.() && !hasUnsavedChanges) return;

    try {
      const state = vfsManager.store?.getState();
      const exists = state?.items.some(function check(n): boolean {
        return n.id === activeNode!.id || !!n.children?.some(check);
      });

      if (exists) {
        const content = activeEditor.getText();
        await engine.writeContent(activeNode.id, content);

        const { metadata, summary } = parseFileInfo(content);
        await engine.updateMetadata(activeNode.id, {
          taskCount: metadata.taskCount,
          clozeCount: metadata.clozeCount,
          mermaidCount: metadata.mermaidCount,
          _summary: summary
        });

        activeEditor.setDirty?.(false);
        hasUnsavedChanges = false;
      }
    } catch (e) {
      console.error('[EditorConnector] Save failed:', e);
    }
  };

    /**
     * Schedules a save operation with debounce.
     */
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(save, saveDebounceMs);
  };
    /**
     * Tears down the current editor instance.
     * Performs: Token increment, Forced Save, Event Unbinding, Destruction.
     */
  const teardown = async () => {
    sessionToken++;
    if (activeEditor) {
      await save();
      unsubscribers.forEach(u => u());
      unsubscribers = [];
      await activeEditor.destroy();
      activeEditor = null;
      activeNode = null;
      lastTaskStats = null;
      hasUnsavedChanges = false;
      onEditorCreated?.(null);
    }
  };

  const createHostContext = (): EditorHostContext => {
    const external = factoryExtraOptions.hostContext as EditorHostContext | undefined;
    return {
      toggleSidebar: () => vfsManager.toggleSidebar(),
      saveContent: (nodeId, content) => engine.writeContent(nodeId, content),
      navigate: async (request: NavigationRequest) => {
        if (external?.navigate) await external.navigate(request);
        else console.warn('[EditorConnector] No navigation handler.', request);
      }
    };
  };

  const handleSessionChange = async ({ item }: { item?: VFSNodeUI }) => {
    await teardown();
    const myToken = sessionToken;
    editorContainer.innerHTML = '';

    if (!item || item.type !== 'file') {
      editorContainer.innerHTML = '<div class="editor-placeholder">Select a file...</div>';
      return;
    }

    setTimeout(async () => {
      if (myToken !== sessionToken) return;

      try {
        const factory = vfsManager.resolveEditorFactory?.(item) || defaultEditorFactory;
        if (!factory) throw new Error("No suitable editor factory found.");

        const editorOptions: EditorOptions = {
          ...factoryExtraOptions,
          initialContent: item.content?.data || '',
          title: item.metadata.title,
          nodeId: item.id,
          language: item.metadata.custom?._extension || '',
          sessionEngine: engine,
          hostContext: createHostContext()
        };

        const editor = await factory(editorContainer, editorOptions);
        if (myToken !== sessionToken) { editor?.destroy(); return; }

        activeEditor = editor;
        activeNode = item;
        lastTaskStats = item.metadata.custom.taskCount || null;
        hasUnsavedChanges = false;

        if (activeEditor) {
          const bindEditorEvent = (eventName: string, handler: (...args: any[]) => void) => {
            try {
              // 使用 any 类型绕过严格的类型检查，因为不同编辑器可能有不同的事件签名
              const unsub = (activeEditor as any).on(eventName, handler);
              if (typeof unsub === 'function') {
                unsubscribers.push(unsub);
              }
            } catch (e) {
              console.warn(`[EditorConnector] Failed to bind event '${eventName}':`, e);
            }
          };

          bindEditorEvent('blur', scheduleSave);
          bindEditorEvent('modeChanged', (p: any) => p?.mode === 'render' && save());
          bindEditorEvent('interactiveChange', () => { optimisticUpdate(); scheduleSave(); });
          bindEditorEvent('optimisticUpdate', optimisticUpdate);
        }

        onEditorCreated?.(activeEditor);
      } catch (e) {
        if (myToken === sessionToken) {
          console.error('[EditorConnector] Create failed:', e);
          editorContainer.innerHTML = `<div class="editor-placeholder editor-placeholder--error">Error: ${(e as Error).message}</div>`;
        }
      }
    }, 0);
  };

  const unsubNav = vfsManager.on('navigateToHeading', async ({ elementId }: { elementId: string }) => {
    activeEditor?.navigateTo({ elementId });
  });

  const unsubSession = vfsManager.on('sessionSelected', handleSessionChange);
  handleSessionChange({ item: vfsManager.getActiveSession() });

  return () => {
    unsubSession();
    unsubNav();
    teardown().catch(console.error);
  };
}
