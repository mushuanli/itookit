/**
 * @file vfs-ui/adapters/PlainTextAdapter.ts
 */
import { VFSCore, VNode } from '@itookit/vfs-core';
import type {
  IContentViewAdapter,
  IEditor,
  EditorFactory,
  EditorContent,
  ContentMetadata
} from '../interfaces/IVFSUIManager';

/**
 * 纯文本适配器
 * 作为默认的回退适配器，处理所有未知类型的内容
 * 
 * 注意：需要外部提供 EditorFactory
 */
export class PlainTextAdapter implements IContentViewAdapter {
  private vfs?: VFSCore;
  private editorFactory?: EditorFactory;

  constructor(vfs?: VFSCore, editorFactory?: EditorFactory) {
    this.vfs = vfs;
    this.editorFactory = editorFactory;
  }

  /**
   * 可以处理任何节点（作为回退）
   */
  canHandle(node: VNode): boolean {
    return true;
  }

  /**
   * 创建编辑器
   */
  async createEditor(
    container: HTMLElement,
    node: VNode
  ): Promise<IEditor> {
    if (!this.editorFactory) {
      throw new Error('No editor factory provided for PlainTextAdapter');
    }

    let content = '';
    if (this.vfs) {
      const result = await this.vfs.read(node.id);
      content = result.content;
    }

    const editor = this.editorFactory(container, node, {
      initialContent: content,
      readOnly: false
    });

    // 绑定保存事件
    if (this.vfs) {
      editor.on('change', this._debounce(async () => {
        try {
          await this.vfs!.write(node.id, editor.getText());
        } catch (error) {
          console.error('Failed to save:', error);
        }
      }, 500));
    }

    return editor;
  }

  /**
   * 加载内容
   */
  async loadContent(node: VNode): Promise<EditorContent> {
    if (!this.vfs) {
      return { raw: '' };
    }

    const { content } = await this.vfs.read(node.id);

    return {
      raw: content,
      metadata: {
        stats: {
          wordCount: this._countWords(content)
        }
      }
    };
  }

  /**
   * 保存内容
   */
  async saveContent(node: VNode, content: string): Promise<void> {
    if (!this.vfs) {
      throw new Error('VFS not available');
    }
    await this.vfs.write(node.id, content);
  }

  /**
   * 获取元数据
   */
  async getMetadata(node: VNode): Promise<ContentMetadata> {
    if (!this.vfs) {
      return { stats: {} };
    }

    const { content } = await this.vfs.read(node.id);

    return {
      stats: {
        wordCount: this._countWords(content)
      }
    };
  }

  /**
   * 统计字数
   */
  private _countWords(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length;
  }

  /**
   * 防抖
   */
  private _debounce<T extends (...args: any[]) => any>(
    func: T,
    wait: number
  ): (...args: Parameters<T>) => void {
    let timeout: NodeJS.Timeout | null = null;
    return (...args: Parameters<T>) => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
  }
}
