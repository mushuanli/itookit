/**
 * @file vfs-ui/integrations/editor-connector.ts
 * @desc Provides a high-level function to connect a VFS-UI manager with any IEditor-compatible editor.
 *       Optimized with debounce saving and async initialization, guarded against race conditions.
 */
import type { 
    IEditor, 
    EditorFactory, 
    EditorOptions, 
    ISessionUI, 
    ISessionEngine, 
    EditorHostContext,
    NavigationRequest 
} from '@itookit/common';
import type { VFSNodeUI, VFSUIState } from '../types/types';
import type { VFSService } from '../services/VFSService';
import { parseFileInfo } from '../utils/parser';

export interface ConnectOptions {
    /** Callback fired when an editor instance is fully created and mounted */
    onEditorCreated?: (editor: IEditor | null) => void;
    /** Time in ms to wait before auto-saving after the last keystroke. Default: 500ms */
    saveDebounceMs?: number;
    /** Any extra options to pass to the editor factory (including hostContext from upstream) */
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
 * Connects a session manager to an editor.
 * 
 * [Updated] Now supports dynamic editor factory resolution via vfsManager.
 */
export function connectEditorLifecycle(
    // 使用扩展类型，以便访问 resolveEditorFactory
    vfsManager: ISessionUI<VFSNodeUI, VFSService> & { resolveEditorFactory?: (node: VFSNodeUI) => EditorFactory },
    engine: ISessionEngine,
    editorContainer: HTMLElement,
    // [Change] This parameter is now optional or acts as a fallback default
    defaultEditorFactory?: EditorFactory, 
    options: ConnectOptions = {}
): () => void {
    let activeEditor: IEditor | null = null;
    let activeNode: VFSNodeUI | null = null;
    let activeEditorUnsubscribers: Array<() => void> = [];
    let saveTimer: any = null;
    let currentSessionToken = 0;

    let lastKnownTaskStats: { total: number; completed: number } | null = null;
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
            lastKnownTaskStats = stats;
            hasUnsavedOptimisticChanges = true;

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
                await engine.writeContent(activeNode.id, contentToSave);
                
                const parseResult = parseFileInfo(contentToSave);
                const metadataUpdates = {
                    taskCount: parseResult.metadata.taskCount,
                    clozeCount: parseResult.metadata.clozeCount,
                    mermaidCount: parseResult.metadata.mermaidCount,
                    _summary: parseResult.summary 
                };
                await engine.updateMetadata(activeNode.id, metadataUpdates);
                
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
                    // 动态解析 Factory
                    let targetFactory: EditorFactory | undefined;

                    // 1. 优先尝试使用 Manager 的解析器 (支持扩展名注册和自定义 resolver)
                    if (typeof vfsManager.resolveEditorFactory === 'function') {
                        targetFactory = vfsManager.resolveEditorFactory(item);
                    }
                    
                    // 2. 回退到传入 connector 的默认 factory
                    if (!targetFactory) {
                        targetFactory = defaultEditorFactory;
                    }

                    if (!targetFactory) {
                        throw new Error("No suitable editor factory found.");
                    }

                    // ✅ [关键修改] 获取上层(MemoryManager)传入的 HostContext
                    const externalHostContext = factoryExtraOptions.hostContext as EditorHostContext | undefined;

                    // ✅ [关键修改] 组装混合 HostContext：既包含 VFS 内部能力，也透传外部能力
                    const hostContext: EditorHostContext = {
                        toggleSidebar: (collapsed?: boolean) => {
                            // 调用 VFS 内部侧边栏切换
                            vfsManager.toggleSidebar();
                            // 如果外部也需要感知，透传调用
                            externalHostContext?.toggleSidebar?.(collapsed);
                        },
                        saveContent: async (nodeId, content) => {
                            // 直接写入 Engine
                            await engine.writeContent(nodeId, content);
                        },
                        navigate: async (request: NavigationRequest) => {
                            // ✅ 关键：如果外部提供了 navigate 处理函数（MemoryManager -> Main），则转发
                            if (externalHostContext?.navigate) {
                                console.log('[EditorConnector] Forwarding navigation request:', request);
                                await externalHostContext.navigate(request);
                            } else {
                                // 只有在没有外部宿主时才警告
                                console.warn('[EditorConnector] Default navigation handler: No host connected.', request);
                            }
                        }
                    };

                    const content = item.content?.data || '';
                    
                    const editorOptions: EditorOptions = {
                        ...factoryExtraOptions,
                        initialContent: content,
                        title: item.metadata.title,
                        nodeId: item.id,
                        // 传递扩展名给编辑器
                        language: item.metadata.custom?._extension || '',
                        
                        // ✅ [关键新增] 注入标准依赖
                        sessionEngine: engine,
                        hostContext: hostContext
                    };

                    const editorInstance = await targetFactory(editorContainer, editorOptions);

                    if (myToken !== currentSessionToken) {
                        if (editorInstance) editorInstance.destroy();
                        return;
                    }

                    activeEditor = editorInstance;
                    activeNode = item;
                    lastKnownTaskStats = item.metadata.custom.taskCount || null;
                    hasUnsavedOptimisticChanges = false;

                    if (activeEditor) {
                        const unsubBlur = activeEditor.on('blur', () => scheduleSave());
                        if (unsubBlur) activeEditorUnsubscribers.push(unsubBlur);

                        const unsubMode = activeEditor.on('modeChanged', (payload: any) => {
                            if (payload && payload.mode === 'render') saveCurrentSession();
                        });
                        if (unsubMode) activeEditorUnsubscribers.push(unsubMode);
                        
                        const unsubChange = activeEditor.on('interactiveChange', () => { 
                            performOptimisticUpdate();
                            scheduleSave(); 
                        });
                        if (unsubChange) activeEditorUnsubscribers.push(unsubChange);

                        const unsubOptimistic = activeEditor.on('optimisticUpdate', () => {
                             performOptimisticUpdate();
                        });
                        if (unsubOptimistic) activeEditorUnsubscribers.push(unsubOptimistic);
                    }

                    if (onEditorCreated) onEditorCreated(activeEditor);

                } catch (error) {
                    if (myToken === currentSessionToken) {
                        console.error(`[EditorConnector] Create failed:`, error);
                        editorContainer.innerHTML = `<div class="editor-placeholder editor-placeholder--error">Error loading file: ${(error as Error).message}</div>`;
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