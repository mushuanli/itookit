/**
 * @file vfs/core/ProviderRegistry.ts
 * Provider 注册管理
 */

import { IProvider } from './types.js';
import { VNode, Transaction } from '../store/types.js';

export class ProviderRegistry {
  // 将 private 改为 protected，以便子类 EnhancedProviderRegistry 可以直接访问（可选，但推荐）
  // 或者保持 private，通过 super 方法访问
  protected providers: Map<string, IProvider> = new Map();

  /**
   * 注册 Provider
   */
  register(provider: IProvider): void {
    if (this.providers.has(provider.name)) {
      console.warn(`Provider '${provider.name}' already registered, overwriting`);
    }
    this.providers.set(provider.name, provider);
  }

  /**
   * 注销 Provider
   * [FIX] 改为 async 并返回 Promise<boolean> 以兼容 EnhancedProviderRegistry
   */
  async unregister(name: string): Promise<boolean> {
    return this.providers.delete(name);
  }

  /**
   * 获取 Provider
   */
  get(name: string): IProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * 获取所有 Providers
   */
  getAll(): IProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * 执行所有 Provider 的验证
   */
  async runValidation(vnode: VNode, content: string | ArrayBuffer): Promise<void> {
    for (const provider of this.providers.values()) {
      if (provider.onValidate) {
        await provider.onValidate(vnode, content);
      }
    }
  }

  /**
   * [MODIFIED] 执行所有 Provider 的写入前处理
   */
  async runBeforeWrite(
    vnode: VNode,
    content: string | ArrayBuffer,
    transaction: Transaction
  ): Promise<string | ArrayBuffer> {
    let processedContent = content;
    for (const provider of this.providers.values()) {
      if (provider.onBeforeWrite) {
        processedContent = await provider.onBeforeWrite(vnode, processedContent, transaction);
      }
    }
    return processedContent;
  }

  /**
   * [MODIFIED] 执行所有 Provider 的写入后处理
   */
  async runAfterWrite(
    vnode: VNode,
    content: string | ArrayBuffer,
    transaction: Transaction
  ): Promise<Record<string, any>> {
    const derivedData: Record<string, any> = {};
    for (const provider of this.providers.values()) {
      if (provider.onAfterWrite) {
        const data = await provider.onAfterWrite(vnode, content, transaction);
        Object.assign(derivedData, data);
      }
    }
    return derivedData;
  }

  /**
   * [MODIFIED] 执行所有 Provider 的删除前处理
   */
  async runBeforeDelete(vnode: VNode, transaction: Transaction): Promise<void> {
    for (const provider of this.providers.values()) {
      if (provider.onBeforeDelete) {
        await provider.onBeforeDelete(vnode, transaction);
      }
    }
  }

  /**
   * [MODIFIED] 执行所有 Provider 的删除后处理
   */
  async runAfterDelete(vnode: VNode, transaction: Transaction): Promise<void> {
    for (const provider of this.providers.values()) {
      if (provider.onAfterDelete) {
        await provider.onAfterDelete(vnode, transaction);
      }
    }
  }
}
