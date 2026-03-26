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
export { PathResolver, type ResolvedInode } from './engine/path-resolver';
export { toFSNode } from './engine/node-mapper';
export { EventBus, TransactionEventBuffer } from './event/event-bus';
export { PluginPipeline } from './engine/plugin-pipeline';
export { DeviceRegistry } from './engine/device-registry';
export { AccessController, SYSTEM_CALLER, type CallerIdentity } from './engine/access-controller';
export { deleteRecursive, copyRecursive } from './engine/tree-ops';

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
export { VFSModuleEngine } from './adapter-session/VFSModuleEngine';
export {
    BaseModuleService,
    type ChangeListener,
    type ModuleServiceOptions,
} from './adapter-session/BaseModuleService';

// ── 常量 ──
export { ROOT_INO } from './engine/vfs-engine';

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
