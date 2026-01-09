/**
 * @file vfs/middleware/CompositeMiddleware.ts
 * 组合 Middleware（组合模式实现）
 */
import { VNodeData } from '../store/types';
import { VFSStorage } from '../store/VFSStorage';
import { EventBus } from '../core/EventBus';
import { ContentMiddleware } from './base/ContentMiddleware';
import { ITransaction } from '../storage/interfaces/IStorageAdapter';

/**
 * 组合 Middleware
 * 允许将多个小 Middleware 组合成一个功能集
 */
export class CompositeMiddleware extends ContentMiddleware {
  readonly name: string;
  readonly priority: number;

  constructor(private middlewares: ContentMiddleware[]) {
    super();
    this.name = `composite-${middlewares.map(m => m.name).join('-')}`;
    this.priority = middlewares.length > 0
      ? Math.max(...middlewares.map(m => m.priority))
      : 0;
  }

  initialize(storage: VFSStorage, eventBus: EventBus): void {
    super.initialize(storage, eventBus);
    for (const middleware of this.middlewares) {
      middleware.initialize(storage, eventBus);
    }
  }

  canHandle(vnode: VNodeData): boolean {
    return this.middlewares.some(m => m.canHandle(vnode));
  }

  async onValidate(vnode: VNodeData, content: string | ArrayBuffer): Promise<void> {
    for (const m of this.getApplicable(vnode)) {
      await m.onValidate?.(vnode, content);
    }
  }

  async onBeforeWrite(
    vnode: VNodeData,
    content: string | ArrayBuffer,
    tx: ITransaction
  ): Promise<string | ArrayBuffer> {
    let result = content;
    for (const m of this.getApplicable(vnode)) {
      if (m.onBeforeWrite) {
        result = await m.onBeforeWrite(vnode, result, tx);
      }
    }
    return result;
  }

  async onAfterWrite(
    vnode: VNodeData,
    content: string | ArrayBuffer,
    tx: ITransaction
  ): Promise<Record<string, unknown>> {
    const allData: Record<string, unknown> = {};
    for (const m of this.getApplicable(vnode)) {
      if (m.onAfterWrite) {
        Object.assign(allData, await m.onAfterWrite(vnode, content, tx));
      }
    }
    return allData;
  }

  async onBeforeDelete(vnode: VNodeData, tx: ITransaction): Promise<void> {
    for (const m of this.getApplicable(vnode)) {
      await m.onBeforeDelete?.(vnode, tx);
    }
  }

  async onAfterDelete(vnode: VNodeData, tx: ITransaction): Promise<void> {
    for (const m of this.getApplicable(vnode)) {
      await m.onAfterDelete?.(vnode, tx);
    }
  }

  async onAfterMove(
    vnode: VNodeData,
    oldPath: string,
    newPath: string,
    tx: ITransaction
  ): Promise<void> {
    for (const m of this.getApplicable(vnode)) {
      await m.onAfterMove?.(vnode, oldPath, newPath, tx);
    }
  }

  async onAfterCopy(
    sourceNode: VNodeData,
    targetNode: VNodeData,
    tx: ITransaction
  ): Promise<void> {
    for (const m of this.getApplicable(targetNode)) {
      await m.onAfterCopy?.(sourceNode, targetNode, tx);
    }
  }

  async cleanup(): Promise<void> {
    for (const m of this.middlewares) {
      await m.cleanup?.();
    }
  }

  private getApplicable(vnode: VNodeData): ContentMiddleware[] {
    return this.middlewares.filter(m => m.canHandle(vnode));
  }
}
