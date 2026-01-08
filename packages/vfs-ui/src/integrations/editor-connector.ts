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
    let activeEditorUnsubscribers: Array<() => void> = [];
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    let currentSessionToken = 0;
    let lastKnownTaskStats: { total: number; completed: number } | null = null;
    let hasUnsavedOptimisticChanges = false;

    const dispatchMetadataUpdate = (itemId: string, metadata: any) => {
        vfsManager.store?.dispatch({ type: 'ITEM_METADATA_UPDATE', payload: { itemId, metadata } });
    };

    const performOptimisticUpdate = () => {
        if (!activeEditor || !activeNode) return;
        const stats = extractTaskCounts(activeEditor.getText());
        const current = lastKnownTaskStats || activeNode.metadata.custom.taskCount || { total: 0, completed: 0 };

        if (stats.total !== current.total || stats.completed !== current.completed) {
            lastKnownTaskStats = stats;
            hasUnsavedOptimisticChanges = true;
            dispatchMetadataUpdate(activeNode.id, { custom: { ...activeNode.metadata.custom, taskCount: stats } });
        }
    };

    /**
     * 执行保存 (DB Write)
     */
    const saveCurrentSession = async () => {
        if (!activeEditor || !activeNode) return;
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }

        const shouldSave = activeEditor.isDirty?.() || hasUnsavedOptimisticChanges;
        if (!shouldSave) return;

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
                hasUnsavedOptimisticChanges = false;
            }
        } catch (error) {
            console.error('[EditorConnector] Save failed:', error);
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
            onEditorCreated?.(null);
        }
    };

    const createHostContext = (): EditorHostContext => {
        const externalContext = factoryExtraOptions.hostContext as EditorHostContext | undefined;
        return {
            toggleSidebar: () => vfsManager.toggleSidebar(),
            saveContent: (nodeId, content) => engine.writeContent(nodeId, content),
            navigate: async (request: NavigationRequest) => {
                if (externalContext?.navigate) {
                    await externalContext.navigate(request);
                } else {
                    console.warn('[EditorConnector] No navigation handler connected.', request);
                }
            }
        };
    };
    /**
     * Main handler for session selection events.
     */
    const handleSessionChange = async ({ item }: { item?: VFSNodeUI }) => {
        await teardownActiveEditor();
        const myToken = currentSessionToken;
        editorContainer.innerHTML = '';

        if (!item || item.type !== 'file') {
            editorContainer.innerHTML = '<div class="editor-placeholder">Select a file...</div>';
            return;
        }

        setTimeout(async () => {
            if (myToken !== currentSessionToken) return;

            try {
                // Resolve editor factory
                let factory = vfsManager.resolveEditorFactory?.(item) || defaultEditorFactory;
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

                if (myToken !== currentSessionToken) {
                    editor?.destroy();
                    return;
                }

                activeEditor = editor;
                activeNode = item;
                lastKnownTaskStats = item.metadata.custom.taskCount || null;
                hasUnsavedOptimisticChanges = false;

                if (activeEditor) {
                    const events = [
                        ['blur', scheduleSave],
                        ['modeChanged', (p: any) => p?.mode === 'render' && saveCurrentSession()],
                        ['interactiveChange', () => { performOptimisticUpdate(); scheduleSave(); }],
                        ['optimisticUpdate', performOptimisticUpdate]
                    ] as const;

                    events.forEach(([event, handler]) => {
                        const unsub = activeEditor!.on(event, handler as any);
                        if (unsub) activeEditorUnsubscribers.push(unsub);
                    });
                }

                onEditorCreated?.(activeEditor);
            } catch (error) {
                if (myToken === currentSessionToken) {
                    console.error('[EditorConnector] Create failed:', error);
                    editorContainer.innerHTML = `<div class="editor-placeholder editor-placeholder--error">Error: ${(error as Error).message}</div>`;
                }
            }
        }, 0);
    };

    // 监听导航事件
    const unsubNav = vfsManager.on('navigateToHeading', async ({ elementId }: { elementId: string }) => {
        activeEditor?.navigateTo({ elementId });
    });

    const unsubSession = vfsManager.on('sessionSelected', handleSessionChange);

    // Initialize with current session
    handleSessionChange({ item: vfsManager.getActiveSession() });

    return () => {
        unsubSession();
        unsubNav();
        teardownActiveEditor().catch(console.error);
    };
}
