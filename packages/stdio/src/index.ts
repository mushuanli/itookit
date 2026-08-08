/**
 * @file packages/stdio/src/index.ts
 * @desc @itookit/stdio 统一入口 — VFS 协议 + 引擎 + 事件总线 + 工具
 *
 * 使用方式：
 *   import { createVFS, VFSManager, VFSEngine } from '@itookit/stdio';
 *   import { MemoryBackend } from '@itookit/stdio';
 *   import type { IVFSManager, IModuleFS, FSNode } from '@itookit/stdio';
 *   import { EventBus } from '@itookit/stdio';
 */

// ── VFS 协议层 (接口/类型/常量/错误) ──
export * from './protocol';

// ── 事件总线 (通用) ──
export * from './eventbus';

// ── 工厂 ──
export { createVFS } from './factory';

// ── 引擎核心 ──
export { VFSEngine } from './engine/vfs-engine';
export { FSEventBus, TransactionEventBuffer } from './event/event-bus';
export { PluginPipeline } from './engine/plugin-pipeline';
export { DeviceRegistry } from './engine/device-registry';
export { AccessController, SYSTEM_CALLER, type CallerIdentity } from './engine/access-controller';

// ── 服务层实现 ──
export { ModuleFS, type ModuleFSDeps } from './services/ModuleFS';
export { VFSManager } from './services/VFSManager';
export { ConfigService } from './services/ConfigService';
export { ScopedView } from './services/ScopedView';
export { FSMetaDriverAdapter } from './services/FSMetaDriverAdapter';

// ── 内置设备 ──
export { nullDevice, zeroDevice, randomDevice } from './devices';

// ── 后端 ──
export { MemoryBackend } from './backend';

// ── 会话适配器 ──
export {
    BaseModuleService,
    type ChangeListener,
    type ModuleServiceOptions,
} from './adapter-session/BaseModuleService';

// ── File handles ──
export { FileHandle, createFile, MDXFileHandle, createMDXFile } from './file-io';

// ── 工具 ──
export * as pathUtils from './utils/path';
export {
    isHiddenName,
    isAssetDirName,
    isInternalDirName,
    isReservedName,
    toAssetDirName,
    fromAssetDirName,
    validateFilename,
    isPath,
} from './utils/validation';
export { generateId } from './utils/id';
export { toBuffer, toString, toUint8Array } from './utils/encoding';
export { guessMimeType } from './utils/guess-mime-type';
export {
    serialize,
    deserialize,
    decodeContent,
} from './utils/serialization';
export type {
    VFSExportManifest,
    VFSExportFileEntry,
    VFSExportAsset,
    VFSEncodedContent,
    SerializeDeps,
} from './utils/serialization';
