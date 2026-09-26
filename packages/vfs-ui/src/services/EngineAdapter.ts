/**
 * @file vfs-ui/services/EngineAdapter.ts
 * @desc Bridges IFileSystem events → VFSStore dispatches.
 *       Extracted from VFSUIShell to isolate engine coupling.
 */
import type { IFileSystem, FSNode, FSEventType, FSEvent } from '@itookit/vfs-core';
import type { IStatePort, IFileTypePort } from '../contracts/ports';
import type { VFSNodeUI, TagInfo } from '../contracts/types';
import { mapFSNodeToUIItem, mapFSNodesToUIItems } from './NodeMapper';
import { findNodeById, shouldFilterNode, traverseNodes } from '../utils/helpers';
import { adapterDEBUG } from '../utils/adapter-debug';

export class EngineAdapter {
    private queues = {
        update: new Set<string>(),
        delete: new Set<string>(),
        create: new Set<string>(),
    };
    private timers = {
        update: null as any,
        delete: null as any,
        create: null as any,
    };

    private engineUnsubscribe: (() => void) | null = null;
    private loadingFolderIds = new Set<string>();

    constructor(
        private readonly engine: IFileSystem,
        private readonly store: IStatePort,
        private readonly fileTypePort: IFileTypePort,
        private readonly showFileExtensions = false,
        private readonly alwaysLoadedDirectories: string[] = [],
    ) { }

    private get iconResolver() {
        return (name: string, isDir: boolean) => this.fileTypePort.getIcon(name, isDir);
    }

    async loadData(options: { silent?: boolean } = {}): Promise<void> {
        adapterDEBUG.loadData(options.silent ? 'explicit call (silent)' : 'explicit call');
        const previousItems = this.store.getState().items;
        // A silent reload keeps the current list on screen (no "loading" placeholder)
        // and re-reads expanded branches, so the tree neither flashes nor collapses.
        const silent = options.silent === true && previousItems.length > 0;
        try {
            if (!silent) this.store.dispatch({ type: 'ITEMS_LOAD_START' });
            const rootChildren = await this.engine.driver.getChildren('/') as FSNode[];
            const uiItems = mapFSNodesToUIItems(
                rootChildren,
                this.iconResolver,
                undefined,
                this.showFileExtensions
            );
            if (silent || this.alwaysLoadedDirectories.length) await this.reloadOpenChildren(uiItems);
            const tags = this.buildTagsMap(uiItems);
            adapterDEBUG.dispatch('STATE_LOAD_SUCCESS', `${uiItems.length} items`);
            this.store.dispatch({
                type: 'STATE_LOAD_SUCCESS',
                payload: { items: uiItems, tags },
            });
        } catch (error) {
            console.error('[EngineAdapter] Failed to load data:', error);
            this.store.dispatch({ type: 'ITEMS_LOAD_ERROR', payload: { error } });
        }
    }

    /**
     * Re-read the children of every directory that was open before a silent reload.
     * Loaded children are not evidence that a directory is still expanded.
     * Include ancestors for older persisted states that only kept the deepest path.
     */
    private async reloadOpenChildren(next: VFSNodeUI[]): Promise<void> {
        const openBefore = new Set([...this.store.getState().expandedFolderIds, ...this.alwaysLoadedDirectories]);
        for (const id of [...openBefore]) {
            for (let parent = id.slice(0, id.lastIndexOf('/')); parent; parent = parent.slice(0, parent.lastIndexOf('/'))) {
                openBefore.add(parent);
            }
        }

        const walk = async (items: VFSNodeUI[]): Promise<void> => {
            for (const item of items) {
                if (item.type !== 'directory' || !openBefore.has(item.id)) continue;
                const children = await this.engine.driver.getChildren(item.id) as FSNode[];
                const uiChildren = children.map(node =>
                    mapFSNodeToUIItem(node, this.iconResolver, undefined, this.showFileExtensions)
                );
                item.children = uiChildren;
                await walk(uiChildren);
            }
        };
        await walk(next);
    }

    /**
     * Restore directory expansion from persisted expandedFolderIds.
     *
     * Finds the first root-level directory whose children aren't loaded yet
     * and expands it (recursively). The accordion constraint means at most
     * one root-level path is restored.
     *
     * Root-level items may have parentPath === null or parentPath === '/'
     * depending on the storage backend — handled transparently here.
     */
    async restoreExpansion(expandedFolderIds: Set<string>): Promise<void> {
        const { items } = this.store.getState();
        for (const folderId of expandedFolderIds) {
            const node = findNodeById(items, folderId);
            if (!node || node.type !== 'directory') continue;

            const pid = node.metadata.parentPath;
            const isRoot = pid === null || pid === '/';
            if (!isRoot || node.children !== undefined) continue;

            await this.expandDirectory(folderId);
            break; // accordion: at most one root branch
        }
    }

    connectEngineEvents(): () => void {
        const processQueue = async (
            queue: Set<string>,
            action: 'update' | 'delete' | 'create'
        ) => {
            if (!queue.size) return;
            const ids = [...queue];
            queue.clear();
            this.timers[action] = null;

            adapterDEBUG.processing(action, ids);

            if (action === 'delete') {
                adapterDEBUG.dispatch('ITEM_DELETE_SUCCESS', `ids=[${ids.join(',')}]`);
                this.store.dispatch({
                    type: 'ITEM_DELETE_SUCCESS',
                    payload: { itemIds: ids },
                });
                return;
            }

            const items = await Promise.all(
                ids.map(async id => {
                    try {
                        const node = await this.engine.driver.getNode(id) as FSNode | null;
                        adapterDEBUG.nodeResult(id, node);
                        if (!node || shouldFilterNode(node)) {
                            if (action === 'update') {
                                adapterDEBUG.dispatch('ITEM_DELETE_SUCCESS', `filtered id=${id}`);
                                this.store.dispatch({
                                    type: 'ITEM_DELETE_SUCCESS',
                                    payload: { itemIds: [id] },
                                });
                            }
                            return null;
                        }
                        return mapFSNodeToUIItem(node, this.iconResolver, undefined, this.showFileExtensions);
                    } catch {
                        return null;
                    }
                })
            );

            const valid = items.filter(Boolean) as VFSNodeUI[];

            if (action === 'update') {
                adapterDEBUG.dispatch('ITEMS_BATCH_UPDATE_SUCCESS', `[${valid.map(v => v.id).join(',')}]`);
                this.store.dispatch({
                    type: 'ITEMS_BATCH_UPDATE_SUCCESS',
                    payload: {
                        updates: valid.map(v => ({ itemId: v.id, data: v })),
                    },
                });
            } else {
                valid.forEach(item => {
                    const actionType = item.type === 'directory'
                        ? 'FOLDER_CREATE_SUCCESS'
                        : 'SESSION_CREATE_SUCCESS';
                    adapterDEBUG.dispatch(actionType, `id=${item.id} name=${item.metadata.title}`);
                    this.store.dispatch({ type: actionType, payload: item });
                });
            }
        };

        const scheduleProcess = (
            queue: Set<string>,
            action: 'update' | 'delete' | 'create',
            delay: number
        ) => {
            if (!this.timers[action]) {
                this.timers[action] = setTimeout(
                    () => processQueue(queue, action),
                    delay
                );
            }
        };

        const handleEvent = (event: FSEvent) => {
            const { type, payload } = event;
            adapterDEBUG.received(type, payload);

            switch (type) {
                case 'node:created': {
                    const data = payload as { nodes?: Array<{ path: string }> };
                    data.nodes?.forEach(n => {
                        if (n.path) {
                            this.queues.create.add(n.path);
                            adapterDEBUG.queued('create', n.path, this.queues.create.size);
                        }
                    });
                    if (this.queues.create.size) scheduleProcess(this.queues.create, 'create', 50);
                    break;
                }
                case 'node:deleted': {
                    const data = payload as { allDeletedPaths?: string[]; requestedPaths?: string[] };
                    (data.allDeletedPaths || data.requestedPaths || [])
                        .filter(Boolean)
                        .forEach(path => {
                            this.queues.delete.add(path);
                            adapterDEBUG.queued('delete', path, this.queues.delete.size);
                        });
                    if (this.queues.delete.size) scheduleProcess(this.queues.delete, 'delete', 20);
                    break;
                }
                case 'node:updated': {
                    const data = payload as { nodes?: Array<{ path: string }>; reason?: string };
                    data.nodes?.forEach(n => {
                        if (!n.path) return;
                        this.queues.update.add(n.path);
                        adapterDEBUG.queued('update', n.path, this.queues.update.size);
                    });
                    if (this.queues.update.size) scheduleProcess(this.queues.update, 'update', 50);
                    break;
                }
                case 'node:moved': {
                    adapterDEBUG.loadData('node:moved event');
                    this.loadData();
                    adapterDEBUG.dispatch('MOVE_OPERATION_END', '');
                    this.store.dispatch({ type: 'MOVE_OPERATION_END' });
                    break;
                }
                case 'node:renamed': {
                    const data = payload as { nodes?: Array<{ oldPath: string; newPath: string; oldName: string; newName: string }> };
                    void (async () => {
                        for (const n of data.nodes ?? []) {
                            if (!n.oldPath || !n.newPath) continue;
                            try {
                                const node = await this.engine.driver.getNode(n.newPath) as FSNode | null;
                                adapterDEBUG.nodeResult(n.newPath, node);
                                if (!node || shouldFilterNode(node)) continue;
                                const newItem = mapFSNodeToUIItem(node, this.iconResolver, undefined, this.showFileExtensions);
                                adapterDEBUG.dispatch('ITEM_RENAME_SUCCESS', `${n.oldPath} → ${newItem.id}`);
                                this.store.dispatch({
                                    type: 'ITEM_RENAME_SUCCESS',
                                    payload: { oldId: n.oldPath, newItem },
                                });
                            } catch {
                                adapterDEBUG.loadData('node:renamed getNode failed');
                                this.loadData();
                            }
                        }
                    })();
                    break;
                }
            }
        };

        const eventTypes: FSEventType[] = [
            'node:created',
            'node:updated',
            'node:deleted',
            'node:moved',
            'node:renamed',
        ];

        const unsubs = eventTypes.map(type =>
            this.engine.driver.on(type, handleEvent as (e: FSEvent<typeof type>) => void)
        );
        this.engineUnsubscribe = () => unsubs.forEach(u => u());
        return this.engineUnsubscribe;
    }

    private buildTagsMap(items: VFSNodeUI[]): Map<string, TagInfo> {
        const map = new Map<string, TagInfo>();
        traverseNodes(items, item => {
            item.metadata.tags?.forEach(tag => {
                if (!map.has(tag))
                    map.set(tag, { name: tag, color: null, itemIds: new Set() });
                map.get(tag)!.itemIds.add(item.id);
            });
        });
        return map;
    }

    async expandDirectory(folderId: string, options: { restoreDescendants?: boolean; expand?: boolean } = {}): Promise<void> {
        if (this.loadingFolderIds.has(folderId)) return;
        this.loadingFolderIds.add(folderId);

        try {
            const children = await this.engine.driver.getChildren(folderId) as FSNode[];
            const uiChildren = children.map(n =>
                mapFSNodeToUIItem(n, this.iconResolver, undefined, this.showFileExtensions)
            );

            this.store.dispatch({
                type: 'FOLDER_CHILDREN_LOADED',
                payload: { parentPath: folderId, children: uiChildren, expand: options.expand },
            });
            if (options.restoreDescendants === false) return;

            // Recursively expand persisted subdirectories so the full tree is
            // restored before the shell re-emits sessionSelected.
            const { expandedFolderIds } = this.store.getState();
            for (const child of uiChildren) {
                if (
                    child.type === 'directory' &&
                    expandedFolderIds.has(child.id) &&
                    child.children === undefined
                ) {
                    await this.expandDirectory(child.id);
                    break; // accordion: at most one child branch per level
                }
            }
        } catch (err) {
            console.error('[EngineAdapter] expandDirectory failed:', folderId, err);
        } finally {
            this.loadingFolderIds.delete(folderId);
        }
    }

    destroy(): void {
        this.engineUnsubscribe?.();
        Object.values(this.timers).forEach(t => t && clearTimeout(t));
    }
}
