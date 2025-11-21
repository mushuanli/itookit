/**
 * @file vfs/middleware/CompositeMiddleware.ts
 * 组合 Middleware（组合模式实现）
 */

import { VNode, Transaction } from '../store/types.js';
import { VFSStorage } from '../store/VFSStorage.js';
import { EventBus } from '../core/EventBus.js';
import { ContentMiddleware } from './base/ContentMiddleware.js';

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
    this.priority = middlewares.length > 0 ? Math.max(...middlewares.map(m => m.priority)) : 0;
  }

  initialize(storage: VFSStorage, eventBus: EventBus): void {
    super.initialize(storage, eventBus);
    for (const middleware of this.middlewares) {
      middleware.initialize(storage, eventBus);
    }
  }

  canHandle(vnode: VNode): boolean {
    return this.middlewares.some(m => m.canHandle(vnode));
  }

  async onValidate(vnode: VNode, content: string | ArrayBuffer): Promise<void> {
    for (const middleware of this.middlewares) {
      if (middleware.canHandle(vnode) && middleware.onValidate) {
        await middleware.onValidate(vnode, content);
      }
    }
  }

  async onBeforeWrite(
    vnode: VNode,
    content: string | ArrayBuffer,
    transaction: Transaction
  ): Promise<string | ArrayBuffer> {
    let processedContent = content;
    for (const middleware of this.middlewares) {
      if (middleware.canHandle(vnode) && middleware.onBeforeWrite) {
        processedContent = await middleware.onBeforeWrite(
          vnode,
          processedContent,
          transaction
        );
      }
    }
    return processedContent;
  }

  async onAfterWrite(
    vnode: VNode,
    content: string | ArrayBuffer,
    transaction: Transaction
  ): Promise<Record<string, any>> {
    const allData: Record<string, any> = {};
    for (const middleware of this.middlewares) {
      if (middleware.canHandle(vnode) && middleware.onAfterWrite) {
        const data = await middleware.onAfterWrite(vnode, content, transaction);
        Object.assign(allData, data);
      }
    }
    return allData;
  }

  async onBeforeDelete(vnode: VNode, transaction: Transaction): Promise<void> {
    for (const middleware of this.middlewares) {
      if (middleware.canHandle(vnode) && middleware.onBeforeDelete) {
        await middleware.onBeforeDelete(vnode, transaction);
      }
    }
  }

  async onAfterDelete(vnode: VNode, transaction: Transaction): Promise<void> {
    for (const middleware of this.middlewares) {
      if (middleware.canHandle(vnode) && middleware.onAfterDelete) {
        await middleware.onAfterDelete(vnode, transaction);
      }
    }
  }

  async cleanup(): Promise<void> {
    for (const middleware of this.middlewares) {
      if (middleware.cleanup) {
        await middleware.cleanup();
      }
    }
  }
}
