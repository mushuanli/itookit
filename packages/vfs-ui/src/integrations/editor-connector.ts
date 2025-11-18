/**
 * @file vfs-ui/src/integrations/editor-connector.ts
 * @desc Provides a high-level function to connect a VFS-UI manager with any IEditor-compatible editor.
 */
import type { IEditor,ISessionManager,ISessionService } from '@itookit/common';
import type { VFSCore } from '@itookit/vfs-core';
import type { VFSNodeUI } from '../types/types';
import type { VFSService } from '../services/VFSService';

export interface EditorFactoryOptions {
  title?: string;
  [key: string]: any;
}


/**
 * A factory function that creates and initializes an editor instance.
 * @param container - The DOM element to mount the editor into.
 * @param nodeId - The VFS node ID for the content.
 * @param initialContent - The initial text content for the editor.
 * @param options - Additional options, often including the item's title.
 * @returns A promise that resolves to an IEditor instance.
 */
export type EditorFactory = (
    container: HTMLElement,
    nodeId: string,
    initialContent: string,
    options: { title: string, [key: string]: any }
) => Promise<IEditor>;

export interface ConnectOptions {
    onEditorCreated?: (editor: IEditor | null) => void;
    [key: string]: any;
}

/**
 * Connects a session manager to an editor, automatically handling the lifecycle of
 * creating, saving, and destroying the editor instance when the user selects different files.
 *
 * @param vfsManager - The initialized ISessionManager instance (like one from createVFSUI).
 * @param vfsCore - The initialized VFSCore instance, used for direct content IO.
 * @param editorContainer - The DOM element where the editor will be rendered.
 * @param editorFactory - An async function that creates an editor instance.
 * @param options - Additional options, including an `onEditorCreated` callback.
 * @returns An unsubscribe function to disconnect the lifecycle manager.
 */
export function connectEditorLifecycle(
    vfsManager: ISessionManager<VFSNodeUI, VFSService>,
    vfsCore: VFSCore, // [关键修改] 直接注入 VFSCore 依赖
    editorContainer: HTMLElement,
    editorFactory: EditorFactory,
    options: ConnectOptions = {}
): () => void {
    let activeEditor: IEditor | null = null;
    let activeNode: VFSNodeUI | null = null;
    const { onEditorCreated } = options;

    const handleSessionChange = async ({ item }: { item?: VFSNodeUI }) => {
        // --- 1. Save and Destroy the previous editor instance ---
        if (activeEditor && activeNode) {
            console.log(`[EditorConnector] Saving content for node ${activeNode.id} before switching.`);
            try {
                const contentToSave = activeEditor.getText();
        console.log(`[DEBUG] Saving ${contentToSave.length} chars for node ${activeNode.id}`);
                await vfsCore.getVFS().write(activeNode.id, contentToSave);
        console.log(`[DEBUG] Save complete`);
            } catch (error) {
                console.error(`[EditorConnector] Failed to save content for node ${activeNode.id}:`, error);
            }
        }

        if (activeEditor) {
            console.log(`[EditorConnector] Destroying previous editor instance.`);
            await activeEditor.destroy();
            activeEditor = null;
            if (onEditorCreated) onEditorCreated(null);
        }
        
        activeNode = null;
        editorContainer.innerHTML = '';

        // --- 2. Create the new editor instance ---
        if (item && item.type === 'file') {
            console.log(`[EditorConnector] Creating new editor for node ${item.id}.`);
            try {
                // [关键修改] 使用直接注入的 vfsCore
                const content = await vfsCore.getVFS().read(item.id) || '';
        console.log(`[DEBUG] Loaded ${content.length} chars for node ${item.id}`);
        console.log(`[DEBUG] Content preview:`, content.substring(0, 100));
                const factoryOpts = { ...options, title: item.metadata.title };

                activeEditor = await editorFactory(
                    editorContainer,
                    item.id,
                    content as string,
                    factoryOpts
                );
                activeNode = item;
                if (onEditorCreated) onEditorCreated(activeEditor);
            } catch (error) {
                console.error(`[EditorConnector] Failed to create editor for node ${item.id}:`, error);
                editorContainer.innerHTML = `<div class="editor-placeholder editor-placeholder--error">Error loading file: ${item.metadata.title}</div>`;
            }
        } else {
            console.log(`[EditorConnector] No file selected. Showing placeholder.`);
            editorContainer.innerHTML = `<div class="editor-placeholder">Select a file to begin editing.</div>`;
        }
    };

    const unsubscribe = vfsManager.on('sessionSelected', handleSessionChange);

    (async () => {
        const initialItem = vfsManager.getActiveSession();
        await handleSessionChange({ item: initialItem });
    })();


    return unsubscribe;
}
