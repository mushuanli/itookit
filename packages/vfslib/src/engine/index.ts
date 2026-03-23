/**
 * @file packages/vfslib/src/engine/index.ts
 */

export { VFSEngine, ROOT_INO } from './vfs-engine';
export { PathResolver, type ResolvedInode } from './path-resolver';
export { toFSNode } from './node-mapper';
export { AccessController, type CallerIdentity, SYSTEM_CALLER } from './access-controller';
export { PluginPipeline } from './plugin-pipeline';
export { DeviceRegistry } from './device-registry';
export { deleteRecursive, copyRecursive } from './tree-ops';
