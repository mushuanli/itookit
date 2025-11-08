/**
 * @file vfs-ui/adapters/SRSAdapter.ts
 */
import { VFSCore, VNode } from '@itookit/vfs-core';
import { GenericContentAdapter } from './GenericContentAdapter';
import type { EditorContent, ContentMetadata } from '../interfaces/IVFSUIManager';

/**
 * SRS (Spaced Repetition System) 适配器
 * 处理学习卡片内容
 */
export class SRSAdapter extends GenericContentAdapter {
  constructor(editorFactory: any, vfs: VFSCore) {
    super('srs', editorFactory, vfs);
  }

  /**
   * 检查是否能处理
   */
  canHandle(node: VNode): boolean {
    return node.contentType === 'srs';
  }

  /**
   * 加载内容
   */
  async loadContent(node: VNode): Promise<EditorContent> {
    const { content, metadata } = await (this as any).vfs.read(node.id);
    
    const clozes = this._extractClozes(content);
    
    return {
      raw: content,
      metadata: {
        summary: `${clozes.length} cloze deletions`,
        stats: {
          clozeCount: clozes.length,
          wordCount: this._countWords(content)
        }
      }
    };
  }

  /**
   * 获取元数据
   */
  async getMetadata(node: VNode): Promise<ContentMetadata> {
    const { content } = await (this as any).vfs.read(node.id);
    const clozes = this._extractClozes(content);
    
    return {
      summary: `${clozes.length} cloze deletions`,
      stats: {
        clozeCount: clozes.length,
        wordCount: this._countWords(content)
      }
    };
  }

  /**
   * 提取填空题
   */
  private _extractClozes(content: string): any[] {
    const clozes: any[] = [];
    const clozeRegex = /\{\{c(\d+)::([^}]+)\}\}/g;
    
    let match;
    while ((match = clozeRegex.exec(content)) !== null) {
      clozes.push({
        id: parseInt(match[1]),
        text: match[2]
      });
    }
    
    return clozes;
  }

  /**
   * 统计字数
   */
  private _countWords(text: string): number {
    // 移除填空标记
    const cleaned = text.replace(/\{\{c\d+::([^}]+)\}\}/g, '$1');
    return cleaned.trim().split(/\s+/).filter(Boolean).length;
  }
}
