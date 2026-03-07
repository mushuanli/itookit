/**
 * @file common/interfaces/fs/index.ts
 */

// ── 基础类型 ──
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
    FSSearchQuery,
    FSCapabilities,
    FSModuleStats,
} from './types';

// ── 选项 ──
export type {
    ReadOptions,
    WriteOptions,
    CreateFileOptions,
    CreateDirectoryOptions,
    TreeWalkOptions,
    TreeWalkCallback,
} from './options';

// ── 事件 ──
export type {
    FSEventType,
    FSNodeCreatedPayload,
    FSNodeUpdatedPayload,
    FSNodeDeletedPayload,
    FSNodeMovedPayload,
    FSNodeCopiedPayload,
    FSNodeRenamedPayload,
    FSErrorPayload,
    FSEventPayloadMap,
    FSEvent,
} from './events';

// ── 错误 ──
export {
    FSError,
    FSNotFoundError,
    FSReadOnlyError,
    FSCapabilityError,
    FSAlreadyExistsError,
    FSInvalidPathError,
    FSModuleNotFoundError,
    FSConflictError,
} from './errors';
export type { FSErrorCode } from './errors';

// ── 子接口 ──
export type { SeqFileEntry, ISeqFileOperations } from './ISeqFile';
export type { IAssetOperations } from './IAssetOperations';
export type { ITagOperations } from './ITagOperations';
export type { DeviceContext, IDeviceHandler } from './IDeviceFile';

// ── 核心接口 ──
export type { IFSTransaction, IModuleFS } from './IModuleFS';
export type { IConfigService, ConfigFileDescriptor, ConfigChangeEvent } from './IConfigService';

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
    IVFSManager,
} from './IVFSManager';

export type {
    VFSFactoryOptions,
    BrowserVFSOptions,
    ElectronVFSOptions,
    VFSInstance,
    VFSFactory,
} from './IVFSFactory';

export { CONFIG_MODULE } from './constants';
