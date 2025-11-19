/**
 * @file vfs-ui/src/integrations/editor-connector.ts
 * @desc Provides a high-level function to connect a VFS-UI manager with any IEditor-compatible editor.
 */
import type { IEditor, EditorFactory, EditorOptions, ISessionManager } from '@itookit/common';
import type { VFSCore } from '@itookit/vfs-core';
import type { VFSNodeUI, VFSUIState } from '../types/types';
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
    
    // ✨ 用于存储当前编辑器实例的事件解绑函数
    let activeEditorUnsubscribers: Array<() => void> = [];

    const { onEditorCreated, ...factoryExtraOptions } = options;

    /**
     * ✨ [核心] 统一的保存逻辑
     * 封装了检查节点是否存在、获取内容、写入VFS的逻辑
     */
    const saveCurrentSession = async () => {
        // 关键优化点 1: 如果编辑器不存在、节点不存在，或者内容未被修改（非脏），则跳过保存
        if (!activeEditor || !activeNode || !activeEditor.isDirty()) {
            if (activeEditor && !activeEditor.isDirty()) {
                console.log(`[EditorConnector] Content for node ${activeNode.id} is not dirty. Skipping save.`);
            }
            return;
        }

        try {
            // 1. 检查节点是否仍然存在于 State 中 (防止保存到已删除的文件)
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
                // 2. 获取内容并保存
                const contentToSave = activeEditor.getText();
                
                // 可选：这里可以增加一个脏检查 (dirty check)，比对上次保存的内容，减少不必要的 IO
                console.log(`[EditorConnector] Auto-saving node ${activeNode.id}...`);
                await vfsCore.getVFS().write(activeNode.id, contentToSave);

                // 关键优化点 2: 保存成功后，重置编辑器的脏状态
                activeEditor.setDirty(false);
            } else {
                console.warn(`[EditorConnector] Node ${activeNode.id} was deleted. Skipping save.`);
            }
        } catch (error) {
            // 即使节点存在，写入也可能失败，所以保留 catch
            console.error(`[EditorConnector] Failed to save content for node ${activeNode?.id}:`, error);
        }
    };

    /**
     * ✨ [核心] 清理当前编辑器：保存、解绑事件、销毁实例
     * 这是一个原子操作，用于 Editor 的安全卸载
     */
    const teardownActiveEditor = async () => {
        if (activeEditor) {
            // 1. 保存 (Save)
            await saveCurrentSession();
            
            // 2. 解绑事件 (Unsubscribe)
            activeEditorUnsubscribers.forEach(unsub => unsub());
            activeEditorUnsubscribers = [];

            // 3. 销毁 (Destroy)
            console.log(`[EditorConnector] Destroying editor instance.`);
            await activeEditor.destroy();
            
            // 4. 清理引用
            activeEditor = null;
            activeNode = null;

            if (onEditorCreated) onEditorCreated(null);
        }
    };

    const handleSessionChange = async ({ item }: { item?: VFSNodeUI }) => {
        // --- 1. Teardown previous editor (Save & Destroy) ---
        await teardownActiveEditor();
        
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

                // ✨ [核心] 绑定自动保存事件
                if (activeEditor) {
                    // A. 失去焦点时保存 (Blur)
                    // 由于 IEditor 基类已更新，这里可以直接监听 blur
                    const unsubBlur = activeEditor.on('blur', () => {
                        console.log('[EditorConnector] Editor blurred. Saving...');
                        saveCurrentSession();
                    });
                    if (unsubBlur) activeEditorUnsubscribers.push(unsubBlur);

                    // B. 模式切换时保存 (Edit -> Render)
                    const unsubMode = activeEditor.on('modeChanged', (payload: any) => {
                        if (payload && payload.mode === 'render') {
                            console.log('[EditorConnector] Switched to render mode. Saving...');
                            saveCurrentSession();
                        }
                    });
                    if (unsubMode) activeEditorUnsubscribers.push(unsubMode);
                }

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

    const unsubscribeSessionListener = vfsManager.on('sessionSelected', handleSessionChange);

    // 初始化加载
    (async () => {
        const initialItem = vfsManager.getActiveSession();
        await handleSessionChange({ item: initialItem });
    })();

    // 返回全局清理函数 (当 connector 被断开时调用)
    return () => {
        unsubscribeSessionListener();
        // ✨ 确保最后一次保存并清理
        teardownActiveEditor().catch(err => console.error('Error during final teardown:', err));
    };
}
