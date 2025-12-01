/**
 * @file vfs/store/index.ts
 * VFS Storage Layer
 * 导出所有存储相关的类和类型
 */

export { Database } from './Database.js';
export { BaseStore } from './BaseStore.js';
export { InodeStore } from './InodeStore.js';
export { ContentStore } from './ContentStore.js';
export { VFSStorage } from './VFSStorage.js';
export { SRSStore } from './SRSStore.js'; // ✨ [新增]

export {
  VFS_STORES,
  VNode,
  VNodeType,
  Transaction,
  type VNodeData,
  type ContentData,
  type SRSItemData, // ✨ [新增]
  type TransactionMode,
  type DatabaseConfig
} from './types.js';
