// @file packages/vfs-middleware/src/MiddlewareRegistry.ts

import { VNodeData, ITransaction } from '../core';
import { IMiddleware } from './interfaces/IMiddleware';

/**
 * 中间件注册表
 */
export class MiddlewareRegistry {
  private middlewares = new Map<string, IMiddleware>();
  private sortedCache: IMiddleware[] | null = null;

  /**
   * 注册中间件
   */
  register(middleware: IMiddleware): void {
    this.middlewares.set(middleware.name, middleware);
    this.sortedCache = null;
  }

  /**
   * 注销中间件
   */
  async unregister(name: string): Promise<boolean> {
    const middleware = this.middlewares.get(name);
    if (!middleware) return false;
    
    await middleware.dispose?.();
    this.middlewares.delete(name);
    this.sortedCache = null;
    return true;
  }

  /**
   * 获取中间件
   */
  get(name: string): IMiddleware | undefined {
    return this.middlewares.get(name);
  }

  /**
   * 获取所有中间件（按优先级排序）
   */
  getAll(): IMiddleware[] {
    if (!this.sortedCache) {
      this.sortedCache = Array.from(this.middlewares.values())
        .sort((a, b) => b.priority - a.priority);
    }
    return this.sortedCache;
  }

  /**
   * 获取可处理指定节点的中间件
   */
  getForNode(node: VNodeData): IMiddleware[] {
    return this.getAll().filter(m => !m.canHandle || m.canHandle(node));
  }

  // ==================== 批量执行钩子 ====================

  async runValidation(node: VNodeData, content: string | ArrayBuffer): Promise<void> {
    for (const m of this.getForNode(node)) {
      await m.onValidate?.(node, content);
    }
  }

  async runBeforeWrite(
    node: VNodeData,
    content: string | ArrayBuffer,
    tx: ITransaction
  ): Promise<string | ArrayBuffer> {
    let result = content;
    for (const m of this.getForNode(node)) {
      if (m.onBeforeWrite) {
        result = await m.onBeforeWrite(node, result, tx);
      }
    }
    return result;
  }

  async runAfterWrite(
    node: VNodeData,
    content: string | ArrayBuffer,
    tx: ITransaction
  ): Promise<Record<string, unknown>> {
    const derivedData: Record<string, unknown> = {};
    for (const m of this.getForNode(node)) {
      if (m.onAfterWrite) {
        Object.assign(derivedData, await m.onAfterWrite(node, content, tx));
      }
    }
    return derivedData;
  }

  async runBeforeDelete(node: VNodeData, tx: ITransaction): Promise<void> {
    for (const m of this.getForNode(node)) {
      await m.onBeforeDelete?.(node, tx);
    }
  }

  async runAfterDelete(node: VNodeData, tx: ITransaction): Promise<void> {
    for (const m of this.getForNode(node)) {
      await m.onAfterDelete?.(node, tx);
    }
  }

  async runAfterMove(
    node: VNodeData,
    oldPath: string,
    newPath: string,
    tx: ITransaction
  ): Promise<void> {
    for (const m of this.getForNode(node)) {
      await m.onAfterMove?.(node, oldPath, newPath, tx);
    }
  }

  async runAfterCopy(
    source: VNodeData,
    target: VNodeData,
    tx: ITransaction
  ): Promise<void> {
    for (const m of this.getForNode(target)) {
      await m.onAfterCopy?.(source, target, tx);
    }
  }

  async runAfterRead(
    node: VNodeData,
    content: string | ArrayBuffer
  ): Promise<string | ArrayBuffer> {
    let result = content;
    for (const m of this.getForNode(node)) {
      if (m.onAfterRead) {
        result = await m.onAfterRead(node, result);
      }
    }
    return result;
  }

  /**
   * 清理所有中间件
   */
  async clear(): Promise<void> {
    await Promise.all(this.getAll().map(m => m.dispose?.()));
    this.middlewares.clear();
    this.sortedCache = null;
  }
}
