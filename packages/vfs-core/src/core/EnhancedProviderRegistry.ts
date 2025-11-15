/**
 * @file vfs/core/EnhancedProviderRegistry.ts
 * 增强的 Provider 注册表（支持优先级、类型映射和钩子）
 */

import { ContentProvider } from '../provider/base/ContentProvider.js';
import { VNode } from '../store/types.js';
import { ProviderRegistry } from './ProviderRegistry.js';

/**
 * Provider 钩子类型
 */
export enum ProviderHook {
  REGISTERED = 'provider:registered',
  UNREGISTERED = 'provider:unregistered'
}

type HookHandler = (providerName: string) => void;

/**
 * 增强的 Provider 注册表
 */
export class EnhancedProviderRegistry extends ProviderRegistry {
  private typeMapping: Map<string, string[]> = new Map();
  private hooks: Map<ProviderHook, Set<HookHandler>> = new Map();

  register(provider: ContentProvider): void {
    super.register(provider);
    this._triggerHook(ProviderHook.REGISTERED, provider.name);
  }

  /**
   * 注销 Provider
   */
  async unregister(name: string): Promise<boolean> {
    const provider = this.get(name) as ContentProvider | undefined;
    if (!provider) return false;

    // 执行清理
    if (provider.cleanup) {
      await provider.cleanup();
    }
    const deleted = await super.unregister(name);
    if (deleted) {
      this._triggerHook(ProviderHook.UNREGISTERED, name);
    }
    return deleted;
  }

  /**
   * 获取 Provider
   */
  get(name: string): ContentProvider | undefined {
    // 因为我们知道在这个注册表里只注册 ContentProvider 实例，
    // 所以这个类型转换是安全的。
    return super.get(name) as ContentProvider | undefined;
  }

  /**
   * 获取所有 Providers
   */
  getAll(): ContentProvider[] {
    return super.getAll() as unknown as ContentProvider[];
  }

  /**
   * 获取适用于指定节点的 Providers（按优先级排序）
   */
  getProvidersForNode(vnode: VNode): ContentProvider[] {
    return this.getAll()
      .filter(provider => provider.canHandle(vnode))
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * 映射内容类型到 Provider 列表
   */
  mapType(contentType: string, providerNames: string[]): void {
    this.typeMapping.set(contentType, providerNames);
  }

  /**
   * 获取内容类型的默认 Providers
   */
  getProvidersForType(contentType: string): ContentProvider[] {
    const names = this.typeMapping.get(contentType) || [];
    return names
      .map(name => this.get(name) as ContentProvider | undefined)
      .filter((p): p is ContentProvider => p !== undefined);
  }

  /**
   * 注册钩子
   */
  onHook(hook: ProviderHook, handler: HookHandler): () => void {
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
   * 清空所有 Providers
   */
  async clear(): Promise<void> {
    const cleanupPromises = this.getAll().map(provider => provider.cleanup?.());
    await Promise.all(cleanupPromises.filter(Boolean));
    
    // 这里不能用 forEach + await，改为普通的 for 循环或者 Promise.all
    const names = this.getAll().map(p => p.name);
    for (const name of names) {
        await super.unregister(name);
    }
    
    this.typeMapping.clear();
    this.hooks.clear();
  }

  /**
   * 触发钩子
   */
  private _triggerHook(hook: ProviderHook, providerName: string): void {
    const handlers = this.hooks.get(hook);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(providerName);
        } catch (error) {
          console.error(`Error in provider hook ${hook}:`, error);
        }
      });
    }
  }
}
