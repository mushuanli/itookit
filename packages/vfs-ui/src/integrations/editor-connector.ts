/**
 * @file vfs-ui/integrations/editor-connector.ts
 * @desc Provides a high-level function to connect a VFS-UI manager with any IEditor-compatible editor.
 *       Optimized with debounce saving and async initialization, guarded against race conditions.
 */
import type { IEditor, EditorFactory, EditorOptions, ISessionUI, ISessionEngine } from '@itookit/common';
import type { VFSNodeUI, VFSUIState } from '../types/types';
import type { VFSService } from '../services/VFSService';

export interface ConnectOptions {
    /** Callback fired when an editor instance is fully created and mounted */
    onEditorCreated?: (editor: IEditor | null) => void;
    /** Time in ms to wait before auto-saving after the last keystroke. Default: 500ms */
    saveDebounceMs?: number;
    /** Any extra options to pass to the editor factory */
    [key: string]: any;
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
    // --- State Variables ---
    let activeEditor: IEditor | null = null;
    let activeNode: VFSNodeUI | null = null;
    let activeEditorUnsubscribers: Array<() => void> = [];
    let saveTimer: any = null;

    // ✨ [CRITICAL FIX] Token to track the current valid session.
    // Incremented on every file switch to invalidate pending async operations.
    let currentSessionToken = 0;

    const { onEditorCreated, saveDebounceMs = 500, ...factoryExtraOptions } = options;

    /**
     * Schedules a save operation with debounce.
     * Call this on every keystroke/change event.
     */
    const scheduleSave = () => {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(saveCurrentSession, saveDebounceMs);
    };

    /**
     * Immediately executes the save operation.
     * Handles dirty checks, node existence checks, and VFS writing.
     */
    const saveCurrentSession = async () => {
        // 1. Basic validation
        if (!activeEditor || !activeNode) return;

        // 2. Clear pending timers since we are saving now
        if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }

        // 3. Dirty Check (Optimization): Don't write if nothing changed
        if (activeEditor.isDirty && !activeEditor.isDirty()) {
            return;
        }

        try {
            // 4. Safety Check: Ensure the node still exists in the store.
            // (Prevents resurrecting deleted files)
            const currentState: VFSUIState = (vfsManager as any).store.getState();
            const nodeExists = (nodes: VFSNodeUI[]): boolean => {
                for (const n of nodes) {
                    if (n.id === activeNode!.id) return true;
                    if (n.children && nodeExists(n.children)) return true;
                }
                return false;
            };

            if (nodeExists(currentState.items)) {
                // 5. Perform Write
                const contentToSave = activeEditor.getText();
                await engine.writeContent(activeNode.id, contentToSave);
                if (activeEditor.setDirty) activeEditor.setDirty(false);
            } else {
                console.warn(`[EditorConnector] Node ${activeNode.id} was deleted. Skipping save.`);
            }
        } catch (error) {
            console.error(`[EditorConnector] Failed to save content for node ${activeNode?.id}:`, error);
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

                    if (activeEditor) {
                        const unsubBlur = activeEditor.on('blur', () => { scheduleSave(); });
                        if (unsubBlur) activeEditorUnsubscribers.push(unsubBlur);

                        const unsubMode = activeEditor.on('modeChanged', (payload: any) => {
                            if (payload && payload.mode === 'render') {
                                saveCurrentSession();
                            }
                        });
                        if (unsubMode) activeEditorUnsubscribers.push(unsubMode);
                    }

                    if (onEditorCreated) onEditorCreated(activeEditor);

                } catch (error) {
                    if (myToken === currentSessionToken) {
                        console.error(`[EditorConnector] Failed to create editor for node ${item.id}:`, error);
                        editorContainer.innerHTML = `<div class="editor-placeholder editor-placeholder--error">Error loading file: ${item.metadata.title}</div>`;
                    }
                }
            };
            setTimeout(initEditor, 0);
        } else {
            editorContainer.innerHTML = `<div class="editor-placeholder">Select a file to begin editing.</div>`;
        }
    };

    // [Core Fix] 监听导航事件
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
        unsubscribeNav(); // 别忘了清理导航监听
        teardownActiveEditor().catch(err => console.error('Error during final teardown:', err));
    };
}