import type { StoreFactory } from '../../editor/contracts';
import { MemoryStore } from './memory-store';
export type { ScopedPersistenceStore } from '../types';
import type { ScopedPersistenceStore } from '../types';

export interface StoreFactoryConfig {
    pluginName: string;
    instanceId: string;
    documentPath?: string;
    factory?: StoreFactory;
}

export function createStore(config: StoreFactoryConfig): ScopedPersistenceStore {
    return config.factory?.(config.pluginName, config.instanceId, config.documentPath) ?? new MemoryStore();
}
