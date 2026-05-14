/**
 * @file packages/vfslib/src/index.ts
 * @desc vfslib 主入口 — 导出所有公共 API
 *
 * 使用方式：
 *   import { createVFS, VFSManager, VFSEngine } from '@anthropic/vfslib';
 *   import { MemoryBackend } from '@anthropic/vfslib/backend';
 */

// ── 工厂 ──
export { createVFS } from './factory';

// ── 引擎核心 ──
export { VFSEngine } from './engine/vfs-engine';
export { EventBus, TransactionEventBuffer } from './event/event-bus';
export { PluginPipeline } from './engine/plugin-pipeline';
export { DeviceRegistry } from './engine/device-registry';
export { AccessController, SYSTEM_CALLER, type CallerIdentity } from './engine/access-controller';

// ── 服务层 ──
export { ModuleFS, type ModuleFSDeps } from './services/module-fs';
export { VFSManager } from './services/vfs-manager';
export { ConfigService } from './services/config-service';
export { ScopedView } from './services/scoped-view';
export { encodeId, decodeId } from './services/id-mapper';

// ── 内置设备 ──
export { nullDevice, zeroDevice, randomDevice } from './devices';

// ── 后端 ──
export { MemoryBackend } from './backend';

// ── セッションアダプター ──
export {
    BaseModuleService,
    type ChangeListener,
    type ModuleServiceOptions,
} from './adapter-session/BaseModuleService';

// ── 常量 ──
// ROOT_INO removed in v4.1 — path-based engine uses '/' instead

// ── File handles ──
export { FileHandle, createFile, MDXFileHandle, createMDXFile, ChatFileHandle, createChatFile } from './file-io';

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
