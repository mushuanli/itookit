/**
 * @file vfs-protocol/src/index.ts
 * @desc VFS 接口统一导出
 *
 * 使用方式：
 *   import type { IModuleFS, FSNode, FSFileNode } from '@itookit/vfs-protocol';
 *   import { FSError, FSNotFoundError } from '@itookit/vfs-protocol';
 */

// ── 常量 ──
export {
    CONFIG_MODULE,
    ETC_DIR,
    SYSTEM_DIRS,
    ASSET_DIR_PREFIX,
    INTERNAL_DIR_PREFIX,
    HIDDEN_FILE_PREFIX,
    DEFAULT_MAX_SYMLINK_DEPTH,
    DEFAULT_FILENAME_PATTERN,
    DEFAULT_SEARCH_LIMIT,
} from './constants';

// ── 核心类型 ──
export type {
    FSNodeType,
    FSNodeBaseType,
    FSNodeExtendedType,
    FSNode,
    FSFileNode,
    FSDirectoryNode,
    FSSeqFileNode,
    FSDeviceNode,
    FSSymlinkNode,
    FSNodeMetadata,
    DirEntry,
    RefType,
    Reference,
    FileContent,
    FSSearchQuery,
    FSSearchResult,
    FSCapabilities,
    FSModuleStats,
} from './core/types';

// re-export SeqFileEntry from canonical location
export type { SeqFileEntry } from './capabilities/seq-file';

// ── 错误 ──
export {
    FSError,
    FSNotFoundError,
    FSAlreadyExistsError,
    FSAccessDeniedError,
    FSReadOnlyError,
    FSReservedNameError,
    FSCapabilityError,
    FSModuleNotFoundError,
    FSConflictError,
    FSInvalidPathError,
    FSSymlinkLoopError,
    FSCrossMountError,
    FSBusyError,
    FSTypeMismatchError,
    FSDeviceNotFoundError,
    FSDeviceFrozenError,
} from './core/errors';
export type { FSErrorCode } from './core/errors';

// ── 选项 ──
export type {
    VisibilityOptions,
    ReadOptions,
    WriteOptions,
    CreateFileOptions,
    CreateDirectoryOptions,
    DeleteOptions,
    RenameOptions,
    MoveOptions,
    CopyOptions,
    ListOptions,
    TreeWalkOptions,
    TreeWalkCallback,
} from './core/options';

// ── 事件 ──
export type {
    FSEventType,
    FSEvent,
    FSNodeCreatedPayload,
    FSNodeUpdatedPayload,
    FSNodeDeletedPayload,
    FSNodeMovedPayload,
    FSNodeCopiedPayload,
    FSNodeRenamedPayload,
    FSMountPayload,
    FSErrorPayload,
    FSEventPayloadMap,
    FSEventEmitter,
} from './core/events';

// ── 存储后端 ──
export type {
    IStorageBackend,
    RecordValue,
    QueryOperator,
    RecordQuery,
    RecordQueryOptions,
    RecordQueryResult,
    RecordWalkOptions,
    IRecordStore,
} from './storage';
export { hasRecordStore } from './storage';

// ── 能力子接口 ──
export type { ISeqFileOperations } from './capabilities/seq-file';
export type { IAssetOperations } from './capabilities/asset-ops';
export type { TagDefinition, ITagOperations } from './capabilities/tag-ops';
export type { RefQueryOptions, IRefOperations } from './capabilities/ref-ops';
export type {
    FileChangeEvent,
    WatchOptions,
    Watcher,
    IWatchOperations,
} from './capabilities/watch';

// ── 设备 ──
export type {
    DeviceContext,
    IDeviceDriver,
    IDeviceManager,
    IDeviceHandle,
} from './device/device';
export { createDeviceHandle } from './device/device';

// ── 插件 ──
export type {
    FSOperationType,
    OperationContext,
    MiddlewareNext,
    MiddlewareHandler,
    PluginInfo,
    IPlugin,
    IPluginManager,
} from './plugin/plugin';

// ── 挂载 ──
export type {
    MountPoint,
    MountOptions,
    ResolvedMount,
    IMountRouter,
} from './mount/mount';

// ── 同步 ──
export type {
    ChangeLogEntry,
    SyncState,
    SyncConflict,
    ConflictResolution,
    ConflictResolver,
    SyncTarget,
    SyncResult,
    ISyncService,
} from './sync/sync';

// ── 文件句柄 ──
export type { AssetObj, IFile } from './IFile';
export type { IMDXFile } from './IMDXFile';

// ── 驱动接口 ──
export type { IFSDriverTransaction, IFSDriver } from './services/fs-driver';
export type { IFSMetaDriver } from './services/fs-meta-driver';

// ── 模块文件系统 ──
export type { IModuleFS } from './services/module-fs';

// ── VFS 管理器 ──
export type {
    ModuleInfo,
    ModuleMountOptions,
    VFSManagerEventType,
    VFSManagerEvent,
    VFSManagerEventPayloadMap,
    GlobalTagInfo,
    SyncableFileInfo,
    ModuleExportData,
    VFSSearchQuery,
    VFSSystemStats,
    IMountService,
    IMaintenanceService,
    IVFSManager,
} from './services/vfs-manager';

// ── 配置服务 ──
export type {
    ConfigFileDescriptor,
    ConfigChangeEvent,
    IConfigService,
} from './services/config-service';

// ── 系统访问 ──
export type { ISystemAccess } from './system-access';

// ── 工厂 ──
export type {
    VFSFactoryOptions,
    BrowserVFSOptions,
    ElectronVFSOptions,
    ServerVFSOptions,
    VFSInstance,
    VFSFactory,
} from './services/factory';
