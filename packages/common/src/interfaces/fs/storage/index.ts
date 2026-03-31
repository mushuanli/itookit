/**
 * @file common/interfaces/fs/storage/index.ts
 * @desc 存储层统一导出
 */

// Layer 1
export type { InodeRecord, IInodeStore, InodeWalkOptions } from './inode-store';

// Layer 2
export type { MetaRecord, IMetaStore, MetaWalkOptions } from './meta-store';

// Layer 3
export type { IContentStore } from './content-store';

// 事务作用域
export type { ITransactionScope } from './backend';

// 可选增强
export type {
    RecordValue,
    QueryOperator,
    RecordQuery,
    RecordQueryOptions,
    RecordQueryResult,
    RecordWalkOptions,
    IRecordStore,
} from './record-backend';

export type { ContentStreamOptions, ContentStreamResult } from './content-store';

export type { IHighLevelStore } from './high-level-backend';
export type { ISyncableStore } from './syncable-backend';

// 主接口
export type { IStorageBackend } from './backend';
export { hasRecordStore, hasHighLevelStore, hasSyncableStore } from './backend';
