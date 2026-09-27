import { EditorLease } from './editor-lease';
import { LatestViewLoad } from '../lifecycle/view-load';
import { SubscriptionScope } from '../lifecycle/subscription-scope';
import { fileContentFormat } from './file-format';
import type { EditorFactory } from '@itookit/ui-common';
/**
 * @file app-shell/src/browser/editor-connector.ts
 * @desc Connects VFS-UI with IEditor instances. Updated to work with new shell.
 */
import type {
    NavigationRequest
} from '@itookit/common';
import type { IEditor, EditorOptions, EditorHostContext, EditorEvent, EditorEventCallback } from '@itookit/ui-common';
import type { IFileSystem, FileSystemContext } from '@itookit/vfs-core';

import type { VFSUIShell, VFSNodeUI } from '@itookit/vfs-ui';
import { parseFileInfo, extractTaskCounts } from './parser';
const replacePathPrefix = (path: string, old: string, next: string) => path === old || path.startsWith(old + '/') ? next + path.slice(old.length) : path;
import { MediaViewerEditor, isBinaryViewable } from './MediaViewerEditor';
import { guessMimeType } from '@itookit/vfs-core';



export interface ConnectOptions<Node extends VFSNodeUI = VFSNodeUI> {
  resolveEditor?: (node: Node) => EditorFactory | null | undefined;
  onEditorCreated?: (editor: IEditor | null) => void;
  saveDebounceMs?: number;
  files?: FileSystemContext;
  [key: string]: any;
}

/**
 * Connects a session manager to an editor.
 *
 * The host supplies editor factories and file context.
 */
export function connectEditorLifecycle(
  vfsManager: VFSUIShell,
  engine: IFileSystem,
  editorContainer: HTMLElement,
  defaultEditorFactory?: EditorFactory,
  options: ConnectOptions<VFSNodeUI> = {}
): (() => Promise<void>) & { setVisible(visible: boolean): Promise<void> } {
  const { resolveEditor, onEditorCreated, saveDebounceMs = 500, files = { fs: engine, cwd: '/' }, ...factoryExtraOptions } = options;
  if (files.fs !== engine) throw new Error('Editor file context differs from its file tree');

  let activeEditor: IEditor | null = null;
  let editorLease: EditorLease | undefined;
  let activeNode: VFSNodeUI | null = null;
  let subscriptions = new SubscriptionScope();
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const viewLoads = new LatestViewLoad();
  let visible = true;
  let pendingItem: VFSNodeUI | undefined;
  let teardownPending: Promise<void> | undefined;
  const loads = new Set<Promise<void>>();
  let lastTaskStats: { total: number; completed: number } | null = null;

  const dispatch = (itemId: string, metadata: any) => {
    vfsManager.updateNodeMetadata(itemId, metadata);
  };

  const optimisticUpdate = () => {
    if (!activeEditor || !activeNode) return;
    const stats = extractTaskCounts(activeEditor.getText());
    const current =
      lastTaskStats ||
      activeNode.metadata.custom.taskCount || { total: 0, completed: 0 };

    if (
      stats.total !== current.total ||
      stats.completed !== current.completed
    ) {
      lastTaskStats = stats;
      dispatch(activeNode.id, {
        custom: { ...activeNode.metadata.custom, taskCount: stats },
      });
    }
  };

  const save = async () => {
    if (!activeEditor || !activeNode) return;
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (activeEditor.flushPendingSave) await activeEditor.flushPendingSave();
    else if (activeEditor.isDirty?.()) throw new Error('Dirty editor does not support flushing');
  };

  const persistContent = async (path: string, content: string): Promise<void> => {
    await engine.driver.writeContent(path, content);
    if (fileContentFormat(path).contentFormat !== 'markdown') return;
    try {
      const { metadata, summary } = parseFileInfo(content);
      await engine.driver.updateMetadata(path, { ...metadata, _summary: summary });
    } catch (error) {
      // Derived metadata failure must not turn a successful content write into a retry.
      console.error('[EditorConnector] Metadata refresh failed:', error);
    }
  };

  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { void save().catch(error => console.error('[EditorConnector] Save failed:', error)); }, saveDebounceMs);
  };

  const teardownNow = async () => {
    if (activeEditor) {
      activeEditor.cancelPendingRender?.();
      await save();
      editorLease ??= new EditorLease(activeEditor, async () => subscriptions.dispose());
      await editorLease.dispose();
      editorLease = undefined;
      subscriptions = new SubscriptionScope();
      activeEditor = null;
      activeNode = null;
      lastTaskStats = null;
      onEditorCreated?.(null);
    }
  };

  const teardown = () => teardownPending ??= teardownNow().finally(() => { teardownPending = undefined; });

  const createHostContext = (): EditorHostContext => {
    const external = factoryExtraOptions.hostContext as
      | EditorHostContext
      | undefined;
    return {
      chatFromFile: external?.chatFromFile,
      toggleSidebar: () => vfsManager.toggleSidebar(),
      saveContent: persistContent,
      navigate: async (request: NavigationRequest) => {
        if (external?.navigate) await external.navigate(request);
        else console.warn('[EditorConnector] No navigation handler.', request);
      },
    };
  };

  const handleSessionChange = async ({
    item,
  }: {
    item?: VFSNodeUI;
  }) => {
    pendingItem = item;
    const load = viewLoads.begin();
    if (!visible) return;
    // If this activeId change was caused by a rename, fileRenamed already updated
    // activeNode and called updateNodeId — just skip teardown.
    if (item && activeEditor && activeNode?.id === item.id) return;

    try { await teardown(); }
    catch (error) { console.error('[EditorConnector] Editor retained after save failure', error); return; }
    if (!viewLoads.isCurrent(load) || !visible) return;
    editorContainer.innerHTML = '';

    if (!item || item.type !== 'file') {
      editorContainer.innerHTML =
        '<div class="editor-placeholder">Select a file...</div>';
      return;
    }

    const loading = async () => {
      if (!viewLoads.isCurrent(load)) return;

      try {
        // Resolve MIME type from file extension to decide rendering strategy.
        const extension = (item.metadata.custom?._extension as string | undefined) || '';
        const mimeType = guessMimeType('file' + extension);

        // Read file content (needed by both viewers and text editors).
        // item.content.data is only populated on in-memory update events;
        // on fresh page load, loadTree() omits file content → read from engine.
        const rawContent =
          item.content?.data !== undefined
            ? item.content.data
            : await engine.driver.readContent(item.id);
        if (!viewLoads.isCurrent(load)) return;
        // readContent without 'utf-8' encoding may return ArrayBuffer;
        // text editors need a string (CodeMirror calls .split() on the doc).
        const initialContent =
          typeof rawContent === 'string'
            ? rawContent
            : rawContent instanceof ArrayBuffer
              ? new TextDecoder().decode(rawContent)
              : '';

        // Re-check token after the async readContent — user may have switched files.
        if (!viewLoads.isCurrent(load)) return;

        const mount = document.createElement('div');
        editorContainer.replaceChildren(mount);
        // Binary media files (image/video/audio/PDF): bypass the editor factory entirely.
        // Show a read-only viewer instead — editing binary content has no meaning.
        if (isBinaryViewable(mimeType)) {
            const viewer = new MediaViewerEditor(mimeType);
            await viewer.init(mount, rawContent as string | ArrayBuffer | undefined);
            if (!viewLoads.isCurrent(load)) { await viewer.destroy(); return; }
            activeEditor = viewer;
            activeNode = item;
            onEditorCreated?.(viewer);
            return;
        }

        const factory =
          resolveEditor?.(item) || defaultEditorFactory;
        if (!factory) throw new Error('No suitable editor factory found.');

        const editorOptions: EditorOptions = {
          initialContent: initialContent || '',
          title: item.metadata.title,
          target: { kind: 'file', path: item.id },
          language: item.metadata.custom?._extension || '',
          ...factoryExtraOptions,
          ...fileContentFormat(item.id),
          files, signal: load.signal,
          hostContext: createHostContext(),
        };

        const editor = await factory(mount, editorOptions);
        if (!viewLoads.isCurrent(load)) {
          await editor?.destroy(); mount.remove();
          return;
        }

        activeEditor = editor;
        activeNode = item;
        lastTaskStats = item.metadata.custom.taskCount || null;

        if (activeEditor) {
          const bindEditorEvent = <E extends EditorEvent>(
            eventName: E,
            handler: EditorEventCallback<E>
          ) => {
            try {
              const unsub = activeEditor!.on(eventName, handler);
              if (typeof unsub === 'function') {
                subscriptions.add(unsub);
              }
            } catch (e) {
              console.warn(
                `[EditorConnector] Failed to bind event '${eventName}':`,
                e
              );
            }
          };

          bindEditorEvent('blur', scheduleSave);
          bindEditorEvent('modeChanged', p =>
            p?.mode === 'render' && scheduleSave()
          );
          bindEditorEvent('interactiveChange', () => {
            optimisticUpdate();
            scheduleSave();
          });
          bindEditorEvent('optimisticUpdate', optimisticUpdate);
        }

        onEditorCreated?.(activeEditor);
      } catch (e) {
        if (viewLoads.isCurrent(load)) {
          console.error('[EditorConnector] Create failed:', e);
          editorContainer.innerHTML = `<div class="editor-placeholder editor-placeholder--error">Error: ${(e as Error).message}</div>`;
        }
      }
    };
    const task = new Promise<void>(resolve => setTimeout(resolve, 0)).then(loading);
    loads.add(task);
    void task.finally(() => loads.delete(task));
  };

  const unsubNav = vfsManager.on(
    'navigateToHeading',
    async ({ elementId }: { elementId: string }) => {
      activeEditor?.navigateTo({ elementId });
    }
  );

  const unsubSession = vfsManager.on('sessionSelected', handleSessionChange);

  const unsubRename = vfsManager.on(
    'fileRenamed',
    ({ oldId, newId, item }: { oldId: string; newId: string; item: VFSNodeUI }) => {
      if (!activeEditor || !activeNode) return;
      const renamedNodeId = replacePathPrefix(activeNode.id, oldId, newId);
      if (renamedNodeId === activeNode.id) return;

      const stateItem = vfsManager.getNode(renamedNodeId);
      activeNode = stateItem ?? (activeNode.id === oldId
        ? item
        : { ...activeNode, id: renamedNodeId });
      activeEditor.setTitle(activeNode.metadata.title);
      activeEditor.updateNodeId?.(renamedNodeId);
    }
  );

  // Set initial placeholder — the first sessionSelected event will replace it
  // when VFSUIShell.start() restores the active session.
  editorContainer.innerHTML =
    '<div class="editor-placeholder">Select a file...</div>';

  const dispose = async () => {
    viewLoads.cancel();
    unsubSession();
    unsubNav();
    unsubRename?.();
    await teardown();
    await Promise.allSettled(loads);
  };
  return Object.assign(dispose, { async setVisible(next: boolean): Promise<void> {
    if (visible === next) return;
    visible = next;
    if (!next) {
      viewLoads.cancel();
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      activeEditor?.cancelPendingRender?.();
      await save();
    } else if (pendingItem && activeNode?.id !== pendingItem.id) {
      await handleSessionChange({ item: pendingItem });
    }
  } });
}
