/**
 * @file packages/vfs-ui/adapters/GenericContentAdapter.ts
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
 * 通用内容适配器
 * 通过 EditorFactory 创建编辑器，并提供基本的内容加载/保存功能
 */
export class GenericContentAdapter implements IContentViewAdapter {
  constructor(
    private contentType: string,
    private editorFactory: EditorFactory,
    private vfs: VFSCore
  ) {}

  /**
   * 检查是否能处理此节点
   */
  canHandle(node: VNode): boolean {
    return node.contentType === this.contentType;
  }

  /**
   * 创建编辑器实例
   */
  async createEditor(
    container: HTMLElement,
    node: VNode
  ): Promise<IEditor> {
    // 加载内容
    const content = await this.loadContent(node);

    // 创建编辑器
    const editor = this.editorFactory(container, node, {
      initialContent: content.raw,
      metadata: content.metadata
    });

    // 绑定保存事件
    editor.on('change', this._debounce(async () => {
      try {
        const currentContent = editor.getText();
        await this.saveContent(node, currentContent);
      } catch (error) {
        console.error('Failed to save content:', error);
      }
    }, 500));

    return editor;
  }

  /**
   * 加载内容
   */
  async loadContent(node: VNode): Promise<EditorContent> {
    const { content, metadata } = await this.vfs.read(node.id);

    return {
      raw: content,
      formatted: this._formatContent(content, node.contentType),
      metadata: {
        headings: metadata.headings || [],
        summary: metadata.summary,
        stats: {
          wordCount: this._countWords(content),
          clozeCount: metadata.clozes?.length || 0,
          taskCount: metadata.tasks?.length || 0
        }
      }
    };
  }

  /**
   * 保存内容
   */
  async saveContent(node: VNode, content: string): Promise<void> {
    await this.vfs.write(node.id, content);
  }

  /**
   * 获取元数据
   */
  async getMetadata(node: VNode): Promise<ContentMetadata> {
    const { metadata, content } = await this.vfs.read(node.id);

    return {
      headings: metadata.headings || [],
      summary: metadata.summary,
      stats: {
        wordCount: this._countWords(content),
        clozeCount: metadata.clozes?.length || 0,
        taskCount: metadata.tasks?.length || 0
      }
    };
  }

  /**
   * 格式化内容（可被子类覆盖）
   */
  protected _formatContent(content: string, contentType: string): any {
    return content;
  }

  /**
   * 统计字数
   */
  private _countWords(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length;
  }

  /**
   * 防抖函数
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
