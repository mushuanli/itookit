// @mdx/core/store/types.ts
import type { IPersistenceAdapter, ISessionEngine } from '@itookit/common';
import { EngineMetadataStore } from './engine-metadata-store';
import { AdapterStore } from './adapter-store';
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
    sessionEngine: ISessionEngine | null;
    nodeId: string | null;
    dataAdapter: IPersistenceAdapter | null;
}

/**
 * 三级回退存储工厂
 * Engine Metadata → Persistence Adapter → Memory
 */
export function createStore(config: StoreFactoryConfig): ScopedPersistenceStore {
    const { pluginName, instanceId, sessionEngine, nodeId, dataAdapter } = config;

    // 1. 优先：Engine 元数据存储
    if (sessionEngine && nodeId) {
        return new EngineMetadataStore(sessionEngine, nodeId, pluginName);
    }

    // 2. 其次：持久化适配器
    if (dataAdapter) {
        return new AdapterStore(dataAdapter, `${instanceId}:${pluginName}`);
    }

    // 3. 兜底：内存存储
    return new MemoryStore();
}
