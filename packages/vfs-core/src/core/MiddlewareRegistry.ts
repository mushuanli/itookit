/**
 * @file vfs/core/MiddlewareRegistry.ts
 * 统一的中间件注册表
 */

import { IVFSMiddleware } from './types';
import {ITransaction} from '../storage/interfaces/IStorageAdapter';
import { VNodeData } from '../store/types';

type MiddlewareHookHandler = (name: string) => void;

export class MiddlewareRegistry {
  private middlewares = new Map<string, IVFSMiddleware>();
  private hooks = new Map<string, Set<MiddlewareHookHandler>>();

  /**
   * 注册 Middleware
   */
  register(middleware: IVFSMiddleware): void {
    this.middlewares.set(middleware.name, middleware);
    this.triggerHook('registered', middleware.name);
  }

  /**
   * 注销 Middleware
   */
  async unregister(name: string): Promise<boolean> {
    const middleware = this.middlewares.get(name);
    if (!middleware) return false;
    
    await middleware.cleanup?.();
    this.middlewares.delete(name);
    this.triggerHook('unregistered', name);
    return true;
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

  // 获取适用于节点的中间件（按优先级排序）
  getForNode(vnode: VNodeData): IVFSMiddleware[] {
    return this.getAll()
      .filter(m => !m.canHandle || m.canHandle(vnode))
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  // ==================== 批量执行钩子 ====================

  async runValidation(vnode: VNodeData, content: string | ArrayBuffer): Promise<void> {
    for (const m of this.getForNode(vnode)) {
      await m.onValidate?.(vnode, content);
    }
  }

  async runBeforeWrite(
    vnode: VNodeData, 
    content: string | ArrayBuffer, 
    tx: ITransaction
  ): Promise<string | ArrayBuffer> {
    let result = content;
    for (const m of this.getForNode(vnode)) {
      if (m.onBeforeWrite) {
        result = await m.onBeforeWrite(vnode, result, tx);
      }
    }
    return result;
  }

  async runAfterWrite(
    vnode: VNodeData, 
    content: string | ArrayBuffer, 
    tx: ITransaction
  ): Promise<Record<string, unknown>> {
    const derivedData: Record<string, unknown> = {};
    for (const m of this.getForNode(vnode)) {
      if (m.onAfterWrite) {
        Object.assign(derivedData, await m.onAfterWrite(vnode, content, tx));
      }
    }
    return derivedData;
  }

  async runBeforeDelete(vnode: VNodeData, tx: ITransaction): Promise<void> {
    for (const m of this.getForNode(vnode)) {
      await m.onBeforeDelete?.(vnode, tx);
    }
  }

  async runAfterDelete(vnode: VNodeData, tx: ITransaction): Promise<void> {
    for (const m of this.getForNode(vnode)) {
      await m.onAfterDelete?.(vnode, tx);
    }
  }

  async runAfterMove(
    vnode: VNodeData, 
    oldPath: string, 
    newPath: string, 
    tx: ITransaction
  ): Promise<void> {
    for (const m of this.getForNode(vnode)) {
      await m.onAfterMove?.(vnode, oldPath, newPath, tx);
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

  // ==================== 生命周期钩子 ====================

  onHook(event: 'registered' | 'unregistered', handler: MiddlewareHookHandler): () => void {
    if (!this.hooks.has(event)) this.hooks.set(event, new Set());
    this.hooks.get(event)!.add(handler);
    return () => this.hooks.get(event)?.delete(handler);
  }

  private triggerHook(event: string, name: string): void {
    this.hooks.get(event)?.forEach(h => {
      try { h(name); } catch (e) { console.error(e); }
    });
  }

  async clear(): Promise<void> {
    await Promise.all(this.getAll().map(m => m.cleanup?.()));
    this.middlewares.clear();
    this.hooks.clear();
  }
}
