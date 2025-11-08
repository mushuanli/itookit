// @file vfs-ui/core/EditorRegistry.ts
import { VFSCore, VNode } from '@itookit/vfs-core';
import type { 
  IContentViewAdapter, 
  EditorFactory,
  EditorContent,
  ContentMetadata
} from '../interfaces/IVFSUIManager';
import { GenericContentAdapter } from '../adapters/GenericContentAdapter';
import { PlainTextAdapter } from '../adapters/PlainTextAdapter';

export class EditorRegistry {
  private adapters: Map<string, IContentViewAdapter>;
  private fallbackAdapter: IContentViewAdapter;

  constructor() {
    this.adapters = new Map();
    this.fallbackAdapter = new PlainTextAdapter();
  }

  /**
   * 注册编辑器
   */
  registerEditor(
    contentType: string,
    factory: EditorFactory,
    vfs: VFSCore
  ): void {
    const adapter = new GenericContentAdapter(contentType, factory, vfs);
    this.adapters.set(contentType, adapter);
  }

  /**
   * 注册适配器
   */
  registerAdapter(
    contentType: string,
    adapter: IContentViewAdapter
  ): void {
    this.adapters.set(contentType, adapter);
  }

  /**
   * 获取适配器
   */
  getAdapter(node: VNode): IContentViewAdapter {
    // 1. 精确匹配
    const exact = this.adapters.get(node.contentType);
    if (exact?.canHandle(node)) {
      return exact;
    }

    // 2. 模糊匹配（如 text/* 匹配 text/markdown）
    for (const [pattern, adapter] of this.adapters) {
      if (this._matchContentType(pattern, node.contentType)) {
        if (adapter.canHandle(node)) {
          return adapter;
        }
      }
    }

    // 3. 回退到通用适配器
    return this.fallbackAdapter;
  }

  /**
   * 内容类型匹配
   */
  private _matchContentType(pattern: string, actual: string): boolean {
    if (pattern.includes('*')) {
      const regex = new RegExp(
        '^' + pattern.replace(/\*/g, '.*') + '$'
      );
      return regex.test(actual);
    }
    return pattern === actual;
  }

  /**
   * 检查是否已注册
   */
  hasAdapter(contentType: string): boolean {
    return this.adapters.has(contentType);
  }

  /**
   * 获取所有已注册的内容类型
   */
  getRegisteredTypes(): string[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * 移除适配器
   */
  unregisterAdapter(contentType: string): boolean {
    return this.adapters.delete(contentType);
  }

  /**
   * 清空所有适配器
   */
  clear(): void {
    this.adapters.clear();
  }
}
