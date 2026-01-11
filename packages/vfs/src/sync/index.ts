// @file packages/vfs-sync/src/index.ts

// 主插件
export { SyncPlugin } from './SyncPlugin';

// 类型
export * from './types';

// 常量
export { SYNC_TABLES, SYNC_CONSTANTS, SYNC_MODULE_NAME } from './constants';

// 核心组件（供扩展使用）
export { LogManager } from './core/LogManager';
export { ChunkManager } from './core/ChunkManager';
export { ConflictResolver } from './core/ConflictResolver';
export { SyncFilterEngine } from './core/SyncFilter';
export { Scheduler } from './core/Scheduler';
export { SyncStateStorage } from './core/SyncStateStorage';

// 传输层
//export { NetworkInterface, ChunkRequest } from './transport/NetworkInterface';
//export { WebSocketTransport, WebSocketConfig } from './transport/WebSocketTransport';

// 工具函数
export * from './utils/vectorClock';
export * from './utils/compression';
export * from './utils/metadata';
