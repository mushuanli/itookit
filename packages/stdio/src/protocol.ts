/**
 * @file packages/stdio/src/protocol.ts
 * @desc VFS 协议层统一导出(接口/类型/常量/错误)
 *
 * 使用方式：
 *   import type { IModuleFS, FSNode, FSFileNode } from '@itookit/stdio';
 *   import { FSError, FSNotFoundError } from '@itookit/stdio';
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
    FS_MODULE_CHAT,
    FS_MODULE_AGENTS,
} from './interfaces/constants';

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
} from './interfaces/core/types';

// re-export SeqFileEntry from canonical location
export type { SeqFileEntry } from './interfaces/capabilities/seq-file';

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
} from './interfaces/core/errors';
export type { FSErrorCode } from './interfaces/core/errors';

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
} from './interfaces/core/options';

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
} from './interfaces/core/events';

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
} from './interfaces/storage';
export { hasRecordStore } from './interfaces/storage';

// ── 能力子接口 ──
export type { ISeqFileOperations } from './interfaces/capabilities/seq-file';
export type { IAssetOperations } from './interfaces/capabilities/asset-ops';
export type { TagDefinition, ITagOperations } from './interfaces/capabilities/tag-ops';
export type { RefQueryOptions, IRefOperations } from './interfaces/capabilities/ref-ops';
export type {
    FileChangeEvent,
    WatchOptions,
    Watcher,
    IWatchOperations,
} from './interfaces/capabilities/watch';

// ── 设备 ──
export type {
    DeviceContext,
    IDeviceDriver,
    IDeviceManager,
    IDeviceHandle,
} from './interfaces/device/device';
export { createDeviceHandle } from './interfaces/device/device';

// ── 插件 ──
export type {
    FSOperationType,
    OperationContext,
    MiddlewareNext,
    MiddlewareHandler,
    PluginInfo,
    IPlugin,
    IPluginManager,
} from './interfaces/plugin/plugin';

// ── 挂载 ──
export type {
    MountPoint,
    MountOptions,
    ResolvedMount,
    IMountRouter,
} from './interfaces/mount/mount';

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
} from './interfaces/sync/sync';

// ── 文件句柄 ──
export type { AssetObj, IFile } from './interfaces/IFile';
export type { IMDXFile } from './interfaces/IMDXFile';

// ── 驱动接口 ──
export type { IFSDriverTransaction, IFSDriver } from './interfaces/services/fs-driver';
export type { IFSMetaDriver } from './interfaces/services/fs-meta-driver';

// ── 模块文件系统 ──
export type { IModuleFS } from './interfaces/services/module-fs';

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
} from './interfaces/services/vfs-manager';

// ── 配置服务 ──
export type {
    ConfigFileDescriptor,
    ConfigChangeEvent,
    IConfigService,
} from './interfaces/services/config-service';

// ── 系统访问 ──
export type { ISystemAccess } from './interfaces/system-access';

// ── 通用 IO 流 ──
export type { IIOStream } from './interfaces/io';

// ── 工厂 ──
export type {
    VFSFactoryOptions,
    BrowserVFSOptions,
    ElectronVFSOptions,
    ServerVFSOptions,
    VFSInstance,
    VFSFactory,
} from './interfaces/services/factory';
