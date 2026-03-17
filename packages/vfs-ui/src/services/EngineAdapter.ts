/**
 * @file vfs-ui/services/EngineAdapter.ts
 * @desc Bridges ISessionEngine events → VFSStore dispatches.
 *       Extracted from VFSUIManager to isolate engine coupling.
 */
import type { ISessionEngine, EngineEvent, EngineEventType } from '@itookit/common';
import type { IStatePort, IFileTypePort } from '../contracts/ports';
import type { VFSNodeUI, TagInfo } from '../contracts/types';
import { mapEngineNodeToUIItem, mapEngineTreeToUIItems } from './NodeMapper';
import { isHiddenFile, traverseNodes } from '../utils/helpers';

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
        try {
            this.store.dispatch({ type: 'ITEMS_LOAD_START' });
            const rootChildren = await this.engine.loadTree();
            const uiItems = mapEngineTreeToUIItems(
                rootChildren,
                this.iconResolver,
                this.parserResolver
            );
            const tags = this.buildTagsMap(uiItems);
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

            if (action === 'delete') {
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
                        if (!node || isHiddenFile(node.name)) {
                            if (action === 'update') {
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
                this.store.dispatch({
                    type: 'ITEMS_BATCH_UPDATE_SUCCESS',
                    payload: {
                        updates: valid.map(v => ({ itemId: v.id, data: v })),
                    },
                });
            } else {
                valid.forEach(item => {
                    this.store.dispatch({
                        type:
                            item.type === 'directory'
                                ? 'FOLDER_CREATE_SUCCESS'
                                : 'SESSION_CREATE_SUCCESS',
                        payload: item,
                    });
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

            switch (type) {
                case 'node:created': {
                    const data = payload as { nodeId: string };
                    if (data.nodeId) {
                        this.queues.create.add(data.nodeId);
                        scheduleProcess(this.queues.create, 'create', 50);
                    }
                    break;
                }
                case 'node:deleted': {
                    const data = payload as {
                        nodeId: string;
                        data?: { removedIds?: string[] };
                    };
                    const removedIds =
                        data.data?.removedIds || (data.nodeId ? [data.nodeId] : []);
                    removedIds.filter(Boolean).forEach(id => this.queues.delete.add(id));
                    scheduleProcess(this.queues.delete, 'delete', 20);
                    break;
                }
                case 'node:batch_deleted': {
                    const data = payload as { removedIds: string[] };
                    (data.removedIds || []).forEach(id => this.queues.delete.add(id));
                    scheduleProcess(this.queues.delete, 'delete', 20);
                    break;
                }
                case 'node:updated': {
                    const data = payload as { nodeId: string };
                    if (data.nodeId) {
                        this.queues.update.add(data.nodeId);
                        scheduleProcess(this.queues.update, 'update', 50);
                    }
                    break;
                }
                case 'node:batch_updated': {
                    const data = payload as { updatedNodeIds: string[] };
                    data.updatedNodeIds?.forEach(id => this.queues.update.add(id));
                    scheduleProcess(this.queues.update, 'update', 50);
                    break;
                }
                case 'node:moved':
                case 'node:batch_moved': {
                    this.loadData();
                    this.store.dispatch({ type: 'MOVE_OPERATION_END' });
                    break;
                }
            }
        };

        const eventTypes: EngineEventType[] = [
            'node:created',
            'node:updated',
            'node:deleted',
            'node:moved',
            'node:batch_updated',
            'node:batch_moved',
            'node:batch_deleted',
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
