/**
 * @file packages/vfs-core/src/impl/capabilities/EnginePort.ts
 * @desc 能力类依赖的最小引擎端口（状态 + 路径 + 事件）。
 *
 * 由 ModuleContext 实现。能力类只依赖此接口，可单测、可替换。
 */

import type {
    IStorageBackend,
    FSNode,
    FSEventType,
    FSEventPayloadMap,
} from '../../protocol';
import type { VFSEngine } from '../engine/vfs-engine';

export interface EnginePort {
    readonly moduleId: string;
    readonly engine: VFSEngine;
    readonly backend: IStorageBackend;
    toRealPath(path: string): string;
    toVirtualPath(path: string): string;
    toVirtualNode(node: FSNode): FSNode;
    resolveNode(path: string): Promise<{ node: FSNode; realPath: string }>;
    emit<E extends FSEventType>(type: E, payload: FSEventPayloadMap[E]): void;
}
