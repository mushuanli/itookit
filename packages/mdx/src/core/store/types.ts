// @mdx/core/store/types.ts
import type { IModuleFS } from '@itookit/common';
import { EngineMetadataStore } from './engine-metadata-store';
import { MemoryStore } from './memory-store';

export interface ScopedPersistenceStore {
    get(key: string): Promise<any>;
    set(key: string, value: any): Promise<void>;
    remove(key: string): Promise<void>;
    destroy?(): void;
}

export interface StoreFactoryConfig {
    pluginName: string;
    instanceId: string;
    sessionEngine: IModuleFS | null;
    nodeId: string | null;
}

/**
 * 二级回退存储工厂
 * Engine Metadata → Memory
 */
export function createStore(config: StoreFactoryConfig): ScopedPersistenceStore {
    const { pluginName, sessionEngine, nodeId } = config;

    // 1. 优先：Engine 元数据存储
    if (sessionEngine && nodeId) {
        return new EngineMetadataStore(sessionEngine, nodeId, pluginName);
    }

    // 2. 兜底：内存存储
    return new MemoryStore();
}
