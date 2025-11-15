/**
 * @file vfs/core/ProviderRegistry.ts
 * Provider 注册管理
 */

import { IProvider } from './types.js';
import { VNode, Transaction } from '../store/types.js'; // Import Transaction

export class ProviderRegistry {
  private providers: Map<string, IProvider> = new Map();

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
   */
  unregister(name: string): boolean {
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
    transaction: Transaction // Add transaction parameter
  ): Promise<string | ArrayBuffer> {
    let processedContent = content;
    
    for (const provider of this.providers.values()) {
      if (provider.onBeforeWrite) {
        processedContent = await provider.onBeforeWrite(vnode, processedContent, transaction); // Pass it down
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
    transaction: Transaction // Add transaction parameter
  ): Promise<Record<string, any>> {
    const derivedData: Record<string, any> = {};
    
    for (const provider of this.providers.values()) {
      if (provider.onAfterWrite) {
        const data = await provider.onAfterWrite(vnode, content, transaction); // Pass it down
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
        await provider.onBeforeDelete(vnode, transaction); // Pass it down
      }
    }
  }

  /**
   * [MODIFIED] 执行所有 Provider 的删除后处理
   */
  async runAfterDelete(vnode: VNode, transaction: Transaction): Promise<void> {
    for (const provider of this.providers.values()) {
      if (provider.onAfterDelete) {
        await provider.onAfterDelete(vnode, transaction); // Pass it down
      }
    }
  }
}
