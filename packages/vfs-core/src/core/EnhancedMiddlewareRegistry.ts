/**
 * @file vfs/core/EnhancedMiddlewareRegistry.ts
 * 增强的 Middleware 注册表（支持优先级、类型映射和钩子）
 */

import { ContentMiddleware } from '../middleware/base/ContentMiddleware';
import { VNode } from '../store/types';
import { MiddlewareRegistry } from './MiddlewareRegistry';

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

  register(middleware: ContentMiddleware): void {
    super.register(middleware);
    this._triggerHook(MiddlewareHook.REGISTERED, middleware.name);
  }

  /**
   * 注销 Middleware
   */
  async unregister(name: string): Promise<boolean> {
    const middleware = this.get(name) as ContentMiddleware | undefined;
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
   * 获取 Middleware
   */
  get(name: string): ContentMiddleware | undefined {
    // 因为我们知道在这个注册表里只注册 ContentMiddleware 实例，
    // 所以这个类型转换是安全的。
    return super.get(name) as ContentMiddleware | undefined;
  }

  /**
   * 获取所有 Middlewares
   */
  getAll(): ContentMiddleware[] {
    return super.getAll() as unknown as ContentMiddleware[];
  }

  /**
   * 获取适用于指定节点的 Middlewares（按优先级排序）
   */
  getMiddlewaresForNode(vnode: VNode): ContentMiddleware[] {
    return this.getAll()
      .filter(middleware => middleware.canHandle(vnode))
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * 映射内容类型到 Middleware 列表
   */
  mapType(contentType: string, middlewareNames: string[]): void {
    this.typeMapping.set(contentType, middlewareNames);
  }

  /**
   * 获取内容类型的默认 Middlewares
   */
  getMiddlewaresForType(contentType: string): ContentMiddleware[] {
    const names = this.typeMapping.get(contentType) || [];
    return names
      .map(name => this.get(name) as ContentMiddleware | undefined)
      .filter((p): p is ContentMiddleware => p !== undefined);
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
