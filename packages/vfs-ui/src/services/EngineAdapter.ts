/**
 * @file vfs-ui/services/EngineAdapter.ts
 * @desc Bridges IModuleFS events → VFSStore dispatches.
 *       Extracted from VFSUIShell to isolate engine coupling.
 */
import type { IModuleFS, FSNode, FSEventType, FSEvent } from '@itookit/common';
import type { IStatePort, IFileTypePort } from '../contracts/ports';
import type { VFSNodeUI, TagInfo } from '../contracts/types';
import { mapFSNodeToUIItem, mapFSNodesToUIItems } from './NodeMapper';
import { shouldFilterNode, traverseNodes } from '../utils/helpers';
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
        private readonly engine: IModuleFS,
        private readonly store: IStatePort,
        private readonly fileTypePort: IFileTypePort,
        private readonly showFileExtensions = false,
    ) { }

    private get iconResolver() {
        return (name: string, isDir: boolean) => this.fileTypePort.getIcon(name, isDir);
    }

    async loadData(): Promise<void> {
        adapterDEBUG.loadData('explicit call');
        try {
            this.store.dispatch({ type: 'ITEMS_LOAD_START' });
            const rootChildren = await this.engine.driver.getChildren('/') as FSNode[];
            const uiItems = mapFSNodesToUIItems(
                rootChildren,
                this.iconResolver,
                undefined,
                this.showFileExtensions
            );
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
                    const data = payload as { nodes?: Array<{ nodeId: string }> };
                    data.nodes?.forEach(n => {
                        if (n.nodeId) {
                            this.queues.create.add(n.nodeId);
                            adapterDEBUG.queued('create', n.nodeId, this.queues.create.size);
                        }
                    });
                    if (this.queues.create.size) scheduleProcess(this.queues.create, 'create', 50);
                    break;
                }
                case 'node:deleted': {
                    const data = payload as { allDeletedIds?: string[]; requestedIds?: string[] };
                    (data.allDeletedIds || data.requestedIds || [])
                        .filter(Boolean)
                        .forEach(id => {
                            this.queues.delete.add(id);
                            adapterDEBUG.queued('delete', id, this.queues.delete.size);
                        });
                    if (this.queues.delete.size) scheduleProcess(this.queues.delete, 'delete', 20);
                    break;
                }
                case 'node:updated': {
                    const data = payload as { nodes?: Array<{ nodeId: string }>; reason?: string };
                    if (data.reason === 'metadata') {
                        adapterDEBUG.received('node:updated[metadata-skip]', payload);
                        break;
                    }
                    data.nodes?.forEach(n => {
                        if (n.nodeId) {
                            this.queues.update.add(n.nodeId);
                            adapterDEBUG.queued('update', n.nodeId, this.queues.update.size);
                        }
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
                    const data = payload as { nodes?: Array<{ nodeId: string }> };
                    data.nodes?.forEach(n => {
                        if (n.nodeId) {
                            this.queues.update.add(n.nodeId);
                            adapterDEBUG.queued('update', n.nodeId, this.queues.update.size);
                        }
                    });
                    if (this.queues.update.size) scheduleProcess(this.queues.update, 'update', 50);
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

    async expandDirectory(folderId: string): Promise<void> {
        if (this.loadingFolderIds.has(folderId)) return;
        this.loadingFolderIds.add(folderId);

        try {
            const children = await this.engine.driver.getChildren(folderId) as FSNode[];
            const uiChildren = children.map(n =>
                mapFSNodeToUIItem(n, this.iconResolver, undefined, this.showFileExtensions)
            );

            this.store.dispatch({
                type: 'FOLDER_CHILDREN_LOADED',
                payload: { parentId: folderId, children: uiChildren },
            });

            const { expandedFolderIds } = this.store.getState();
            for (const child of uiChildren) {
                if (
                    child.type === 'directory' &&
                    expandedFolderIds.has(child.id) &&
                    child.children === undefined
                ) {
                    void this.expandDirectory(child.id);
                    break;
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
