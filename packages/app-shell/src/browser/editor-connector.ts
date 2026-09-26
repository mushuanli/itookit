import type { EditorFactory } from '@itookit/ui-common';
/**
 * @file app-shell/src/browser/editor-connector.ts
 * @desc Connects VFS-UI with IEditor instances. Updated to work with new shell.
 */
import type {
    NavigationRequest
} from '@itookit/common';
import type { IEditor, EditorOptions, EditorHostContext } from '@itookit/ui-common';
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
): () => void {
  const { resolveEditor, onEditorCreated, saveDebounceMs = 500, files = { fs: engine, cwd: '/' }, ...factoryExtraOptions } = options;
  if (files.fs !== engine) throw new Error('Editor file context differs from its file tree');

  let activeEditor: IEditor | null = null;
  let activeNode: VFSNodeUI | null = null;
  let unsubscribers: Array<() => void> = [];
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let sessionToken = 0;
  let lastTaskStats: { total: number; completed: number } | null = null;
  let hasUnsavedChanges = false;

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
      hasUnsavedChanges = true;
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
    if (!activeEditor.isDirty?.() && !hasUnsavedChanges) return;

    try {
      const exists = vfsManager.getNode(activeNode.id);

      if (exists) {
        const content = activeEditor.getText();
        await engine.driver.writeContent(activeNode.id, content);

        const { metadata, summary } = parseFileInfo(content);
        await engine.driver.updateMetadata(activeNode.id, {
          taskCount: metadata.taskCount,
          clozeCount: metadata.clozeCount,
          mermaidCount: metadata.mermaidCount,
          _summary: summary,
        });

        activeEditor.setDirty?.(false);
        hasUnsavedChanges = false;
      }
    } catch (e) {
      console.error('[EditorConnector] Save failed:', e);
    }
  };

  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(save, saveDebounceMs);
  };

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
    const external = factoryExtraOptions.hostContext as
      | EditorHostContext
      | undefined;
    return {
      toggleSidebar: () => vfsManager.toggleSidebar(),
      saveContent: (nodeId, content) => engine.driver.writeContent(nodeId, content),
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
    // If this activeId change was caused by a rename, fileRenamed already updated
    // activeNode and called updateNodeId — just skip teardown.
    if (item && activeEditor && activeNode?.id === item.id) return;

    await teardown();
    const myToken = sessionToken;
    editorContainer.innerHTML = '';

    if (!item || item.type !== 'file') {
      editorContainer.innerHTML =
        '<div class="editor-placeholder">Select a file...</div>';
      return;
    }

    setTimeout(async () => {
      if (myToken !== sessionToken) return;

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
        // readContent without 'utf-8' encoding may return ArrayBuffer;
        // text editors need a string (CodeMirror calls .split() on the doc).
        const initialContent =
          typeof rawContent === 'string'
            ? rawContent
            : rawContent instanceof ArrayBuffer
              ? new TextDecoder().decode(rawContent)
              : '';

        // Re-check token after the async readContent — user may have switched files.
        if (myToken !== sessionToken) return;

        // Binary media files (image/video/audio/PDF): bypass the editor factory entirely.
        // Show a read-only viewer instead — editing binary content has no meaning.
        if (isBinaryViewable(mimeType)) {
            const viewer = new MediaViewerEditor(mimeType);
            await viewer.init(editorContainer, rawContent as string | ArrayBuffer | undefined);
            if (myToken !== sessionToken) { await viewer.destroy(); return; }
            activeEditor = viewer;
            activeNode = item;
            hasUnsavedChanges = false;
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
          files,
          hostContext: createHostContext(),
        };

        const editor = await factory(editorContainer, editorOptions);
        if (myToken !== sessionToken) {
          editor?.destroy();
          return;
        }

        activeEditor = editor;
        activeNode = item;
        lastTaskStats = item.metadata.custom.taskCount || null;
        hasUnsavedChanges = false;

        if (activeEditor) {
          const bindEditorEvent = (
            eventName: string,
            handler: (...args: any[]) => void
          ) => {
            try {
              const unsub = (activeEditor as any).on(eventName, handler);
              if (typeof unsub === 'function') {
                unsubscribers.push(unsub);
              }
            } catch (e) {
              console.warn(
                `[EditorConnector] Failed to bind event '${eventName}':`,
                e
              );
            }
          };

          bindEditorEvent('blur', scheduleSave);
          bindEditorEvent('modeChanged', (p: any) =>
            p?.mode === 'render' && save()
          );
          bindEditorEvent('interactiveChange', () => {
            optimisticUpdate();
            scheduleSave();
          });
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

  return () => {
    unsubSession();
    unsubNav();
    unsubRename?.();
    teardown().catch(console.error);
  };
}
