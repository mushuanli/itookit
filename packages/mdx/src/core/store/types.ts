// @mdx/core/store/types.ts
import type { IModuleFS } from '@itookit/vfs-core';
import { EngineMetadataStore } from './engine-metadata-store';
import { MemoryStore } from './memory-store';

export interface ScopedPersistenceStore {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    remove(key: string): Promise<void>;
    updateNodeId?(newNodeId: string): void;
    destroy?(): void;
}

export interface StoreFactoryConfig {
    pluginName: string;
    instanceId: string;
    moduleFS: IModuleFS | null;
    nodeId: string | null;
}

/**
 * 二级回退存储工厂
 * Engine Metadata → Memory
 */
export function createStore(config: StoreFactoryConfig): ScopedPersistenceStore {
    const { pluginName, moduleFS, nodeId } = config;

    // 1. 优先：Engine 元数据存储
    if (moduleFS && nodeId) {
        return new EngineMetadataStore(moduleFS, nodeId, pluginName);
    }

    // 2. 兜底：内存存储
    return new MemoryStore();
}
