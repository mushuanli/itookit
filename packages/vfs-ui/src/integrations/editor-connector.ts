/**
 * @file vfs-ui/src/integrations/editor-connector.ts
 * @desc Provides a high-level function to connect a VFS-UI manager with any IEditor-compatible editor.
 */
import type { IEditor, EditorFactory, EditorOptions, ISessionManager } from '@itookit/common';
import type { VFSCore } from '@itookit/vfs-core';
import type { VFSNodeUI, VFSUIState } from '../types/types'; // ✨ 导入 VFSUIState
import type { VFSService } from '../services/VFSService';

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
    vfsCore: VFSCore,
    editorContainer: HTMLElement,
    editorFactory: EditorFactory,
    options: ConnectOptions = {}
): () => void {
    let activeEditor: IEditor | null = null;
    let activeNode: VFSNodeUI | null = null;
    const { onEditorCreated, ...factoryExtraOptions } = options;

    const handleSessionChange = async ({ item }: { item?: VFSNodeUI }) => {
        // --- 1. Save and Destroy the previous editor instance ---
        if (activeEditor && activeNode) {
            console.log(`[EditorConnector] Saving content for node ${activeNode.id} before switching.`);
            try {
                // ✨ [核心修复] 在保存前检查节点是否已被删除
                const currentState: VFSUIState = (vfsManager as any).store.getState();
                const findNode = (nodes: VFSNodeUI[], id: string): VFSNodeUI | null => {
                    for (const n of nodes) {
                        if (n.id === id) return n;
                        if (n.children) {
                            const found = findNode(n.children, id);
                            if (found) return found;
                        }
                    }
                    return null;
                };

                if (findNode(currentState.items, activeNode.id)) {
                    const contentToSave = activeEditor.getText();
                    console.log(`[DEBUG] Saving ${contentToSave.length} chars for node ${activeNode.id}`);
                    await vfsCore.getVFS().write(activeNode.id, contentToSave);
                    console.log(`[DEBUG] Save complete`);
                } else {
                    console.warn(`[EditorConnector] Node ${activeNode.id} was deleted. Skipping save.`);
                }
            } catch (error) {
                // 即使节点存在，写入也可能失败，所以保留 catch
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
                const content = item.content?.data || '';
                console.log(`[EditorConnector] Preparing options. Content length: ${content.length}. Preview: "${String(content).substring(0, 50)}..."`);
                const editorOptions: EditorOptions = {
                    ...factoryExtraOptions,
                    initialContent: content,
                    title: item.metadata.title,
                    nodeId: item.id,
                };

                activeEditor = await editorFactory(
                    editorContainer,
                    editorOptions
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
