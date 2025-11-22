/**
 * @file vfs-ui/integrations/editor-connector.ts
 * @desc Provides a high-level function to connect a VFS-UI manager with any IEditor-compatible editor.
 *       Optimized with debounce saving and async initialization, guarded against race conditions.
 */
import type { IEditor, EditorFactory, EditorOptions, ISessionUI } from '@itookit/common';
import type { VFSCore } from '@itookit/vfs-core';
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
    vfsCore: VFSCore,
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
                // console.log(`[EditorConnector] Saving node ${activeNode.id}...`);
                await vfsCore.getVFS().write(activeNode.id, contentToSave);

                // 6. Reset Dirty State
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
        // ✨ [CRITICAL] Invalidate any pending async initializations immediately
        currentSessionToken++;
        
        if (activeEditor) {
            // 1. Force Save immediately (skip debounce)
            await saveCurrentSession();
            
            // 2. Unsubscribe events
            activeEditorUnsubscribers.forEach(unsub => unsub());
            activeEditorUnsubscribers = [];

            // 3. Destroy instance
            // console.log(`[EditorConnector] Destroying editor.`);
            await activeEditor.destroy();
            
            // 4. Reset references
            activeEditor = null;
            activeNode = null;

            if (onEditorCreated) onEditorCreated(null);
        }
    };

    /**
     * Main handler for session selection events.
     */
    const handleSessionChange = async ({ item }: { item?: VFSNodeUI }) => {
        // --- 1. Teardown previous editor ---
        await teardownActiveEditor();
        
        // ✨ Capture the token for this specific session attempt
        const myToken = currentSessionToken;

        editorContainer.innerHTML = '';

        // --- 2. Create the new editor instance ---
        if (item && item.type === 'file') {
            
            // ✨ Async Initialization Wrapper
            const initEditor = async () => {
                // Race Condition Check 1:
                // If user switched file again while waiting for setTimeout, abort.
                if (myToken !== currentSessionToken) return;

                try {
                    const content = item.content?.data || '';
                    const editorOptions: EditorOptions = {
                        ...factoryExtraOptions,
                        initialContent: content,
                        title: item.metadata.title,
                        nodeId: item.id,
                    };

                    // Heavy operation: Create Editor
                    const editorInstance = await editorFactory(editorContainer, editorOptions);

                    // Race Condition Check 2:
                    // If user switched file while awaiting editorFactory, destroy this orphan and abort.
                    if (myToken !== currentSessionToken) {
                        console.log(`[EditorConnector] Editor created but stale. Destroying immediately.`);
                        if (editorInstance) editorInstance.destroy();
                        return;
                    }

                    // Success: Assign state
                    activeEditor = editorInstance;
                    activeNode = item;

                    if (activeEditor) {
                        // Bind Events
                        
                        // A. Blur -> Debounced Save
                        const unsubBlur = activeEditor.on('blur', () => {
                            scheduleSave();
                        });
                        if (unsubBlur) activeEditorUnsubscribers.push(unsubBlur);

                        // B. Mode Change (e.g., Edit to Render) -> Immediate Save
                        const unsubMode = activeEditor.on('modeChanged', (payload: any) => {
                            if (payload && payload.mode === 'render') {
                                saveCurrentSession();
                            }
                        });
                        if (unsubMode) activeEditorUnsubscribers.push(unsubMode);
                    }

                    if (onEditorCreated) onEditorCreated(activeEditor);

                } catch (error) {
                    // Only show error if we are still the active session
                    if (myToken === currentSessionToken) {
                        console.error(`[EditorConnector] Failed to create editor for node ${item.id}:`, error);
                        editorContainer.innerHTML = `<div class="editor-placeholder editor-placeholder--error">Error loading file: ${item.metadata.title}</div>`;
                    }
                }
            };

            // ✨ Schedule initialization to next tick to unblock UI
            setTimeout(initEditor, 0);

        } else {
            // No file selected or directory selected
            editorContainer.innerHTML = `<div class="editor-placeholder">Select a file to begin editing.</div>`;
        }
    };

    // Subscribe to VFS Manager events
    const unsubscribeSessionListener = vfsManager.on('sessionSelected', handleSessionChange);

    // Initial Load
    (async () => {
        const initialItem = vfsManager.getActiveSession();
        await handleSessionChange({ item: initialItem });
    })();

    // Return Global Teardown Function
    return () => {
        unsubscribeSessionListener();
        teardownActiveEditor().catch(err => console.error('Error during final teardown:', err));
    };
}