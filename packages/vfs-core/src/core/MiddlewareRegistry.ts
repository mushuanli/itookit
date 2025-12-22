/**
 * @file vfs/core/MiddlewareRegistry.ts
 * Middleware 注册管理
 */

import { IVFSMiddleware } from './types';
import { VNode, Transaction } from '../store/types';

export class MiddlewareRegistry {
  protected middlewares: Map<string, IVFSMiddleware> = new Map();

  /**
   * 注册 Middleware
   */
  register(middleware: IVFSMiddleware): void {
    if (this.middlewares.has(middleware.name)) {
      console.warn(`Middleware '${middleware.name}' already registered, overwriting`);
    }
    this.middlewares.set(middleware.name, middleware);
  }

  /**
   * 注销 Middleware
   */
  async unregister(name: string): Promise<boolean> {
    return this.middlewares.delete(name);
  }

  /**
   * 获取 Middleware
   */
  get(name: string): IVFSMiddleware | undefined {
    return this.middlewares.get(name);
  }

  /**
   * 获取所有 Middlewares
   */
  getAll(): IVFSMiddleware[] {
    return Array.from(this.middlewares.values());
  }

  /**
   * 执行所有 Middleware 的验证
   */
  async runValidation(vnode: VNode, content: string | ArrayBuffer): Promise<void> {
    for (const middleware of this.middlewares.values()) {
      // ✨ [修复] 如果中间件定义了筛选规则，且当前节点不符合规则，则跳过
      if (middleware.canHandle && !middleware.canHandle(vnode)) {
        continue;
      }

      if (middleware.onValidate) {
        await middleware.onValidate(vnode, content);
      }
    }
  }

  /**
   * 执行所有 Middleware 的写入前处理
   */
  async runBeforeWrite(
    vnode: VNode,
    content: string | ArrayBuffer,
    transaction: Transaction
  ): Promise<string | ArrayBuffer> {
    let processedContent = content;
    for (const middleware of this.middlewares.values()) {
      // ✨ [修复]
      if (middleware.canHandle && !middleware.canHandle(vnode)) continue;

      if (middleware.onBeforeWrite) {
        processedContent = await middleware.onBeforeWrite(vnode, processedContent, transaction);
      }
    }
    return processedContent;
  }

  /**
   * 执行所有 Middleware 的写入后处理
   */
  async runAfterWrite(
    vnode: VNode,
    content: string | ArrayBuffer,
    transaction: Transaction
  ): Promise<Record<string, any>> {
    const derivedData: Record<string, any> = {};
    for (const middleware of this.middlewares.values()) {
      // ✨ [修复]
      if (middleware.canHandle && !middleware.canHandle(vnode)) continue;

      if (middleware.onAfterWrite) {
        const data = await middleware.onAfterWrite(vnode, content, transaction);
        Object.assign(derivedData, data);
      }
    }
    return derivedData;
  }

  /**
   * [MODIFIED] 执行所有 Middleware 的删除前处理
   */
  async runBeforeDelete(vnode: VNode, transaction: Transaction): Promise<void> {
    for (const middleware of this.middlewares.values()) {
      // ✨ [修复]
      if (middleware.canHandle && !middleware.canHandle(vnode)) continue;

      if (middleware.onBeforeDelete) {
        await middleware.onBeforeDelete(vnode, transaction);
      }
    }
  }

  /**
   * [MODIFIED] 执行所有 Middleware 的删除后处理
   */
  async runAfterDelete(vnode: VNode, transaction: Transaction): Promise<void> {
    for (const middleware of this.middlewares.values()) {
      // ✨ [修复]
      if (middleware.canHandle && !middleware.canHandle(vnode)) continue;

      if (middleware.onAfterDelete) {
        await middleware.onAfterDelete(vnode, transaction);
      }
    }
  }

  async runAfterMove(
    vnode: VNode, 
    oldPath: string, 
    newPath: string, 
    transaction: Transaction
  ): Promise<void> {
    for (const middleware of this.middlewares.values()) {
      if (middleware.canHandle && !middleware.canHandle(vnode)) continue;
      if (middleware.onAfterMove) await middleware.onAfterMove(vnode, oldPath, newPath, transaction);
    }
  }

  async runAfterCopy(
    sourceNode: VNode, 
    targetNode: VNode, 
    transaction: Transaction
  ): Promise<void> {
    for (const middleware of this.middlewares.values()) {
      // 注意：这里通常检查源节点或目标节点，视业务而定。通常检查目标节点。
      if (middleware.canHandle && !middleware.canHandle(targetNode)) continue;
      if (middleware.onAfterCopy) await middleware.onAfterCopy(sourceNode, targetNode, transaction);
    }
  }



}
