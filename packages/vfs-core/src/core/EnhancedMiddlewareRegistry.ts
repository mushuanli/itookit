/**
 * @file vfs/core/EnhancedMiddlewareRegistry.ts
 * 增强的 Middleware 注册表（支持优先级、类型映射和钩子）
 */

import { VNode } from '../store/types';
import { MiddlewareRegistry } from './MiddlewareRegistry';
// ✨ [新增] 引入通用接口
import { IVFSMiddleware } from './types';

/**
 * Middleware 钩子类型
 */
export enum MiddlewareHook {
  REGISTERED = 'middleware:registered',
  UNREGISTERED = 'middleware:unregistered'
}

type HookHandler = (middlewareName: string) => void;

/**
 * 增强的 Middleware 注册表
 */
export class EnhancedMiddlewareRegistry extends MiddlewareRegistry {
  private typeMapping: Map<string, string[]> = new Map();
  private hooks: Map<MiddlewareHook, Set<HookHandler>> = new Map();

  /**
   * [修改] 参数类型放宽为 IVFSMiddleware
   */
  register(middleware: IVFSMiddleware): void {
    super.register(middleware);
    this._triggerHook(MiddlewareHook.REGISTERED, middleware.name);
  }

  /**
   * 注销 Middleware
   */
  async unregister(name: string): Promise<boolean> {
    const middleware = this.get(name);
    if (!middleware) return false;

    // 执行清理
    if (middleware.cleanup) {
      await middleware.cleanup();
    }
    const deleted = await super.unregister(name);
    if (deleted) {
      this._triggerHook(MiddlewareHook.UNREGISTERED, name);
    }
    return deleted;
  }

  /**
   * [修改] 返回类型改为 IVFSMiddleware
   */
  get(name: string): IVFSMiddleware | undefined {
    return super.get(name);
  }

  /**
   * [修改] 返回类型改为 IVFSMiddleware[]
   */
  getAll(): IVFSMiddleware[] {
    return super.getAll();
  }

  /**
   * 获取适用于指定节点的 Middlewares（按优先级排序）
   * [修改] 增加安全检查，因为并非所有中间件都有 canHandle
   */
  getMiddlewaresForNode(vnode: VNode): IVFSMiddleware[] {
    return this.getAll()
      .filter(middleware => {
          // 安全检查：如果 middleware 实现了 canHandle 则调用，否则视为不处理内容
          return typeof middleware.canHandle === 'function' && middleware.canHandle(vnode);
      })
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  /**
   * 映射内容类型到 Middleware 列表
   */
  mapType(contentType: string, middlewareNames: string[]): void {
    this.typeMapping.set(contentType, middlewareNames);
  }

  /**
   * 获取内容类型的默认 Middlewares
   * [修改] 返回类型修正
   */
  getMiddlewaresForType(contentType: string): IVFSMiddleware[] {
    const names = this.typeMapping.get(contentType) || [];
    return names
      .map(name => this.get(name))
      .filter((p): p is IVFSMiddleware => p !== undefined);
  }

  /**
   * 注册钩子
   */
  onHook(hook: MiddlewareHook, handler: HookHandler): () => void {
    if (!this.hooks.has(hook)) {
      this.hooks.set(hook, new Set());
    }
    
    this.hooks.get(hook)!.add(handler);
    
    return () => {
      const handlers = this.hooks.get(hook);
      if (handlers) {
        handlers.delete(handler);
      }
    };
  }

  /**
   * 清空所有 Middlewares
   */
  async clear(): Promise<void> {
    const cleanupPromises = this.getAll().map(middleware => middleware.cleanup?.());
    await Promise.all(cleanupPromises.filter(Boolean));
    
    // 这里不能用 forEach + await，改为普通的 for 循环或者 Promise.all
    const names = this.getAll().map(m => m.name);
    for (const name of names) {
        await super.unregister(name);
    }
    
    this.typeMapping.clear();
    this.hooks.clear();
  }

  /**
   * 触发钩子
   */
  private _triggerHook(hook: MiddlewareHook, middlewareName: string): void {
    const handlers = this.hooks.get(hook);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(middlewareName);
        } catch (error) {
          console.error(`Error in middleware hook ${hook}:`, error);
        }
      });
    }
  }
}
