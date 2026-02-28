// common/interfaces/fs/index.ts
/**
 * @file common/interfaces/fs/index.ts
 * @desc 文件系统接口模块的统一导出
 */

// ── 基础类型 ──
export type {
    FSNodeType,
    FSNodeBaseType,
    FSNodeExtendedType,
    FSNode,
    FSSearchQuery,
    FSCapabilities,
    FSModuleStats,
} from './types';

// ── 选项类型 ──
export type {
    ReadOptions,
    WriteOptions,
    CreateFileOptions,
    CreateDirectoryOptions,
    TreeWalkOptions,
    TreeWalkCallback,
} from './options';

// ── 事件类型 ──
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

// ── 错误类型 ──
export {
    FSError,
    FSNotFoundError,
    FSReadOnlyError,
    FSCapabilityError,
    FSAlreadyExistsError,
    FSInvalidPathError,
    FSModuleNotFoundError,
} from './errors';
export type { FSErrorCode } from './errors';

// ── SeqFile 接口 ──
export type {
    SeqFileEntry,
    ISeqFileOperations,
} from './ISeqFile';

// ── 设备文件接口 ──
export type { IDeviceHandler } from './IDeviceFile';

// ── SRS 服务接口 ──
export type {
    SRSItemData,
    SRSCardRef,
    SRSStats,
    ISRSService,
} from './ISRSService.ts';

// ── 核心接口 ──
export type { IModuleFS } from './IModuleFS';

export type {
    ModuleInfo,
    ModuleMountOptions,
    VFSManagerEventType,
    VFSManagerEvent,
    VFSManagerEventPayloadMap,
    GlobalTagInfo,
    SyncableFileInfo,
    VFSNodeInfo,
    ConfigFileDescriptor,
    VFSSystemStats,
    IVFSManager,
} from './IVFSManager';

export type {
    VFSFactoryOptions,
    BrowserVFSOptions,
    ElectronVFSOptions,
    VFSFactory,
} from './IVFSFactory';

// ── 常量 ──
export { CONFIG_MODULE } from './constants';
