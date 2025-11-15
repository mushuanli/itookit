/**
 * @file vfs/provider/CompositeProvider.ts
 * 组合 Provider（组合模式实现）
 */

import { VNode, Transaction } from '../store/types.js';
import { VFSStorage } from '../store/VFSStorage.js';
import { EventBus } from '../core/EventBus.js';
import { ContentProvider } from './base/ContentProvider.js';

/**
 * 组合 Provider
 * 允许将多个小 Provider 组合成一个功能集
 */
export class CompositeProvider extends ContentProvider {
  readonly name: string;
  readonly priority: number;

  constructor(private providers: ContentProvider[]) {
    super();
    this.name = `composite-${providers.map(p => p.name).join('-')}`;
    this.priority = providers.length > 0 ? Math.max(...providers.map(p => p.priority)) : 0;
  }

  initialize(storage: VFSStorage, eventBus: EventBus): void {
    super.initialize(storage, eventBus);
    for (const provider of this.providers) {
      provider.initialize(storage, eventBus);
    }
  }

  canHandle(vnode: VNode): boolean {
    return this.providers.some(p => p.canHandle(vnode));
  }

  async onValidate(vnode: VNode, content: string | ArrayBuffer): Promise<void> {
    for (const provider of this.providers) {
      if (provider.canHandle(vnode) && provider.onValidate) {
        await provider.onValidate(vnode, content);
      }
    }
  }

  async onBeforeWrite(
    vnode: VNode,
    content: string | ArrayBuffer,
    transaction: Transaction
  ): Promise<string | ArrayBuffer> {
    let processedContent = content;
    for (const provider of this.providers) {
      if (provider.canHandle(vnode) && provider.onBeforeWrite) {
        processedContent = await provider.onBeforeWrite(
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
    for (const provider of this.providers) {
      if (provider.canHandle(vnode) && provider.onAfterWrite) {
        const data = await provider.onAfterWrite(vnode, content, transaction);
        Object.assign(allData, data);
      }
    }
    return allData;
  }

  async onBeforeDelete(vnode: VNode, transaction: Transaction): Promise<void> {
    for (const provider of this.providers) {
      if (provider.canHandle(vnode) && provider.onBeforeDelete) {
        await provider.onBeforeDelete(vnode, transaction);
      }
    }
  }

  async onAfterDelete(vnode: VNode, transaction: Transaction): Promise<void> {
    for (const provider of this.providers) {
      if (provider.canHandle(vnode) && provider.onAfterDelete) {
        await provider.onAfterDelete(vnode, transaction);
      }
    }
  }

  async cleanup(): Promise<void> {
    for (const provider of this.providers) {
      if (provider.cleanup) {
        await provider.cleanup();
      }
    }
  }
}
