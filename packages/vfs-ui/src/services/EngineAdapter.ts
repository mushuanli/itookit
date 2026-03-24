/**
 * @file vfs-ui/services/EngineAdapter.ts
 * @desc Bridges ISessionEngine events → VFSStore dispatches.
 *       Extracted from VFSUIShell to isolate engine coupling.
 */
import type { ISessionEngine, EngineEvent, EngineEventType } from '@itookit/common';
import type { IStatePort, IFileTypePort } from '../contracts/ports';
import type { VFSNodeUI, TagInfo } from '../contracts/types';
import { mapEngineNodeToUIItem, mapEngineTreeToUIItems } from './NodeMapper';
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

    constructor(
        private readonly engine: ISessionEngine,
        private readonly store: IStatePort,
        private readonly fileTypePort: IFileTypePort
    ) { }

    private get iconResolver() {
        return (name: string, isDir: boolean) => this.fileTypePort.getIcon(name, isDir);
    }

    private get parserResolver() {
        return (name: string) => this.fileTypePort.resolveContentParser(name);
    }

    async loadData(): Promise<void> {
        adapterDEBUG.loadData('explicit call');
        try {
            this.store.dispatch({ type: 'ITEMS_LOAD_START' });
            const rootChildren = await this.engine.loadTree();
            const uiItems = mapEngineTreeToUIItems(
                rootChildren,
                this.iconResolver,
                this.parserResolver
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
                        const node = await this.engine.getNode(id);
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
                        if (node.type === 'file') {
                            node.content = await this.engine.readContent(id);
                        } else {
                            node.children = [];
                        }
                        return mapEngineNodeToUIItem(node, this.iconResolver, this.parserResolver);
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

        const handleEvent = (event: EngineEvent) => {
            const { type, payload } = event;
            adapterDEBUG.received(type, payload);

            switch (type) {
                case 'node:created': {
                    // FSNodeCreatedPayload: { nodes: [{nodeId, parentId, path, type}] }
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
                    // FSNodeDeletedPayload: { requestedIds, allDeletedIds }
                    // node:batch_deleted maps to the same FS event — no separate subscription needed
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
                    // FSNodeUpdatedPayload: { nodes: [{nodeId, path, changedFields?}], reason }
                    // node:batch_updated maps to the same FS event — no separate subscription needed
                    // Skip metadata-only updates — they don't change displayed content or title
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
                    // node:batch_moved maps to the same FS event — no separate subscription needed
                    adapterDEBUG.loadData('node:moved event');
                    this.loadData();
                    adapterDEBUG.dispatch('MOVE_OPERATION_END', '');
                    this.store.dispatch({ type: 'MOVE_OPERATION_END' });
                    break;
                }
            }
        };

        // Subscribe only to the 4 base FS event types.
        // node:batch_updated / node:batch_moved / node:batch_deleted are NOT subscribed
        // separately because VFSModuleEngine maps them to the same underlying FS events
        // (node:updated / node:moved / node:deleted). Subscribing to both would cause
        // handleEvent to fire TWICE for each write/move/delete operation.
        const eventTypes: EngineEventType[] = [
            'node:created',
            'node:updated',  // also covers node:batch_updated (same FS event)
            'node:deleted',  // also covers node:batch_deleted (same FS event)
            'node:moved',    // also covers node:batch_moved (same FS event)
        ];

        const unsubs = eventTypes.map(type => this.engine.on(type, handleEvent));
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

    destroy(): void {
        this.engineUnsubscribe?.();
        Object.values(this.timers).forEach(t => t && clearTimeout(t));
    }
}
