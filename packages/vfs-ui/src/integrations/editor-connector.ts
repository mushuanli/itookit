/**
 * @file vfs-ui/integrations/editor-connector.ts
 * @desc Provides a high-level function to connect a VFS-UI manager with any IEditor-compatible editor.
 *       Optimized with debounce saving and async initialization, guarded against race conditions.
 */
import type { IEditor, EditorFactory, EditorOptions, ISessionUI, ISessionEngine } from '@itookit/common';
import type { VFSNodeUI, VFSUIState } from '../types/types';
import type { VFSService } from '../services/VFSService';
import { parseFileInfo } from '../utils/parser';

export interface ConnectOptions {
    /** Callback fired when an editor instance is fully created and mounted */
    onEditorCreated?: (editor: IEditor | null) => void;
    /** Time in ms to wait before auto-saving after the last keystroke. Default: 500ms */
    saveDebounceMs?: number;
    /** Any extra options to pass to the editor factory */
    [key: string]: any;
}

// 快速提取任务统计 (内存操作，极快)
function quickExtractTaskCounts(content: string): { total: number; completed: number } {
    let total = 0;
    let completed = 0;
    const mdRegex = /(?:^|[\s|])(?:[-+*]|\d+\.)?\s*\[([ xX])\]/g;
    const mdMatches = [...content.matchAll(mdRegex)];
    total += mdMatches.length;
    completed += mdMatches.filter(m => m[1].toLowerCase() === 'x').length;
    
    const htmlRegex = /<input[^>]+type=["']checkbox["'][^>]*>/gi;
    const htmlMatches = [...content.matchAll(htmlRegex)];
    total += htmlMatches.length;
    htmlMatches.forEach(m => { if (/checked/i.test(m[0])) completed++; });
  
    return { total, completed };
}

/**
 * Connects a session manager to an editor, automatically handling the lifecycle of
 * creating, saving, and destroying the editor instance when the user selects different files.
 */
export function connectEditorLifecycle(
    vfsManager: ISessionUI<VFSNodeUI, VFSService>,
    engine: ISessionEngine,
    editorContainer: HTMLElement,
    editorFactory: EditorFactory,
    options: ConnectOptions = {}
): () => void {
    let activeEditor: IEditor | null = null;
    let activeNode: VFSNodeUI | null = null;
    let activeEditorUnsubscribers: Array<() => void> = [];
    let saveTimer: any = null;
    let currentSessionToken = 0;

    // 状态缓存，用于比较和影子脏检查
    let lastKnownTaskStats: { total: number; completed: number } | null = null;
    
    // ✨ [关键] 影子脏状态：标记是否有“乐观更新”导致的数据变更尚未保存
    let hasUnsavedOptimisticChanges = false;

    const { onEditorCreated, saveDebounceMs = 500, ...factoryExtraOptions } = options;

    /**
     * 纯 UI 更新，不涉及任何 IO
     */
    const performOptimisticUpdate = () => {
        if (!activeEditor || !activeNode) return;

        const content = activeEditor.getText();
        const stats = quickExtractTaskCounts(content);
        
        const currentStats = lastKnownTaskStats || activeNode.metadata.custom.taskCount || { total: 0, completed: 0 };
        
        if (stats.total !== currentStats.total || stats.completed !== currentStats.completed) {
            // 1. 标记本地状态
            lastKnownTaskStats = stats;
            hasUnsavedOptimisticChanges = true; // 标记需要保存，但暂不执行

            // 2. 更新 UI
            const store = (vfsManager as any).store;
            if (store && typeof store.dispatch === 'function') {
                const newCustom = { ...activeNode.metadata.custom, taskCount: stats };
                store.dispatch({
                    type: 'ITEM_METADATA_UPDATE',
                    payload: { itemId: activeNode.id, metadata: { custom: newCustom } }
                });
            }
        }
    };

    /**
     * Schedules a save operation with debounce.
     */
    const scheduleSave = () => {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(saveCurrentSession, saveDebounceMs);
    };

    /**
     * 执行保存 (DB Write)
     */
    const saveCurrentSession = async () => {
        if (!activeEditor || !activeNode) return;
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }

        // ✨ [关键] 保存条件：编辑器本身 Dirty (打字)  OR  有未保存的乐观变更 (Checkbox)
        const shouldSave = (activeEditor.isDirty && activeEditor.isDirty()) || hasUnsavedOptimisticChanges;

        if (!shouldSave) {
            return;
        }

        try {
            const currentState: VFSUIState = (vfsManager as any).store.getState();
            const exists = currentState.items.some(function check(n): boolean {
                return n.id === activeNode!.id || (n.children ? n.children.some(check) : false);
            });

            if (exists) {
                const contentToSave = activeEditor.getText();
                
                // 1. 写内容
                await engine.writeContent(activeNode.id, contentToSave);
                
                // 2. 解析并写元数据
                const parseResult = parseFileInfo(contentToSave);
                const metadataUpdates = {
                    taskCount: parseResult.metadata.taskCount,
                    clozeCount: parseResult.metadata.clozeCount,
                    mermaidCount: parseResult.metadata.mermaidCount,
                    _summary: parseResult.summary 
                };
                await engine.updateMetadata(activeNode.id, metadataUpdates);
                
                // 3. 重置所有脏状态
                if (activeEditor.setDirty) activeEditor.setDirty(false);
                hasUnsavedOptimisticChanges = false;
            }
        } catch (error) {
            console.error(`[EditorConnector] Save failed:`, error);
        }
    };

    /**
     * Tears down the current editor instance.
     * Performs: Token increment, Forced Save, Event Unbinding, Destruction.
     */
    const teardownActiveEditor = async () => {
        currentSessionToken++;
        if (activeEditor) {
            // 切换文件前，必须执行保存检查 (此时 hasUnsavedOptimisticChanges 发挥作用)
            await saveCurrentSession(); 
            
            activeEditorUnsubscribers.forEach(unsub => unsub());
            activeEditorUnsubscribers = [];
            await activeEditor.destroy();
            
            activeEditor = null;
            activeNode = null;
            lastKnownTaskStats = null;
            hasUnsavedOptimisticChanges = false;
            
            if (onEditorCreated) onEditorCreated(null);
        }
    };

    /**
     * Main handler for session selection events.
     */
    const handleSessionChange = async ({ item }: { item?: VFSNodeUI }) => {
        await teardownActiveEditor();
        const myToken = currentSessionToken;
        editorContainer.innerHTML = '';

        if (item && item.type === 'file') {
            const initEditor = async () => {
                if (myToken !== currentSessionToken) return;
                try {
                    const content = item.content?.data || '';
                    const editorOptions: EditorOptions = {
                        ...factoryExtraOptions,
                        initialContent: content,
                        title: item.metadata.title,
                        nodeId: item.id,
                    };

                    const editorInstance = await editorFactory(editorContainer, editorOptions);

                    if (myToken !== currentSessionToken) {
                        if (editorInstance) editorInstance.destroy();
                        return;
                    }

                    activeEditor = editorInstance;
                    activeNode = item;
                    lastKnownTaskStats = item.metadata.custom.taskCount || null;
                    hasUnsavedOptimisticChanges = false;

                    if (activeEditor) {
                        // 1. 失焦/模糊 -> 触发保存
                        const unsubBlur = activeEditor.on('blur', () => scheduleSave());
                        if (unsubBlur) activeEditorUnsubscribers.push(unsubBlur);

                        // 2. 模式切换 -> 触发保存
                        const unsubMode = activeEditor.on('modeChanged', (payload: any) => {
                            if (payload && payload.mode === 'render') saveCurrentSession();
                        });
                        if (unsubMode) activeEditorUnsubscribers.push(unsubMode);
                        
                        // 3. 常规输入 -> 更新 UI + 启动保存计时器
                        const unsubChange = activeEditor.on('interactiveChange', () => { 
                            performOptimisticUpdate();
                            scheduleSave(); 
                        });
                        if (unsubChange) activeEditorUnsubscribers.push(unsubChange);

                        // 4. ✨ Checkbox 点击 -> 仅更新 UI
                        // 不调用 scheduleSave。
                        // 数据只会留在内存中，直到上述 1, 2, 3 发生，或者切换文件 (teardown)。
                        const unsubOptimistic = activeEditor.on('optimisticUpdate', () => {
                             performOptimisticUpdate();
                        });
                        if (unsubOptimistic) activeEditorUnsubscribers.push(unsubOptimistic);
                    }

                    if (onEditorCreated) onEditorCreated(activeEditor);

                } catch (error) {
                    if (myToken === currentSessionToken) {
                        console.error(`[EditorConnector] Create failed:`, error);
                        editorContainer.innerHTML = `<div class="editor-placeholder editor-placeholder--error">Error loading file</div>`;
                    }
                }
            };
            setTimeout(initEditor, 0);
        } else {
            editorContainer.innerHTML = `<div class="editor-placeholder">Select a file...</div>`;
        }
    };

    // 监听导航事件
    const unsubscribeNav = vfsManager.on('navigateToHeading', async (payload: { elementId: string }) => {
        if (activeEditor) {
            // 如果需要，可以在这里自动切换到 render 模式
            // if (activeEditor.getMode() === 'edit') await activeEditor.switchToMode('render');
            
            console.log('[EditorConnector] Navigating to:', payload.elementId);
            await activeEditor.navigateTo({ elementId: payload.elementId });
        }
    });

    const unsubscribeSessionListener = vfsManager.on('sessionSelected', handleSessionChange);

    (async () => {
        const initialItem = vfsManager.getActiveSession();
        await handleSessionChange({ item: initialItem });
    })();

    return () => {
        unsubscribeSessionListener();
        unsubscribeNav();
        teardownActiveEditor().catch(err => console.error('Error during final teardown:', err));
    };
}