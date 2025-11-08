/**
 * @file vfs-ui/adapters/IContentViewAdapter.ts
 */
import { VNode } from '@itookit/vfs-core';
import type { IEditor, EditorContent, ContentMetadata } from '../interfaces/IVFSUIManager';

/**
 * 内容视图适配器接口
 * 负责将 VNode 适配到具体的编辑器实现
 */
export interface IContentViewAdapter {
  /**
   * 检查是否能处理此节点
   */
  canHandle(node: VNode): boolean;

  /**
   * 创建编辑器实例
   */
  createEditor(
    container: HTMLElement,
    node: VNode
  ): Promise<IEditor>;

  /**
   * 加载内容
   */
  loadContent(node: VNode): Promise<EditorContent>;

  /**
   * 保存内容
   */
  saveContent(
    node: VNode,
    content: string
  ): Promise<void>;

  /**
   * 获取元数据（用于大纲等）
   */
  getMetadata(node: VNode): Promise<ContentMetadata>;
}
