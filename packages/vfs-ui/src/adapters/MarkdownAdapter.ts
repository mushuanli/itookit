/**
 * @file vfs-ui/adapters/MarkdownAdapter.ts
 */
import { VFSCore, VNode } from '@itookit/vfs-core';
import { GenericContentAdapter } from './GenericContentAdapter';
import type {
  EditorContent,
  ContentMetadata,
  Heading
} from '../interfaces/IVFSUIManager';

/**
 * Markdown 适配器
 * 提供 Markdown 特定的功能，如标题提取、任务统计等
 */
export class MarkdownAdapter extends GenericContentAdapter {
  constructor(editorFactory: any, vfs: VFSCore) {
    super('text/markdown', editorFactory, vfs);
  }

  /**
   * 检查是否能处理
   */
  canHandle(node: VNode): boolean {
    return node.contentType === 'text/markdown' || 
           node.contentType === 'markdown' ||
           node.name.endsWith('.md');
  }

  /**
   * 加载内容（增强版）
   */
  async loadContent(node: VNode): Promise<EditorContent> {
    const baseContent = await super.loadContent(node);
    
    // 提取 Markdown 特定元数据
    const headings = this._extractHeadings(baseContent.raw);
    const tasks = this._extractTasks(baseContent.raw);
    const links = this._extractLinks(baseContent.raw);

    return {
      ...baseContent,
      metadata: {
        ...baseContent.metadata,
        headings,
        stats: {
          ...baseContent.metadata?.stats,
          taskCount: tasks.length,
          linkCount: links.length
        }
      }
    };
  }

  /**
   * 获取元数据（增强版）
   */
  async getMetadata(node: VNode): Promise<ContentMetadata> {
    const { content } = await (this as any).vfs.read(node.id);
    
    const headings = this._extractHeadings(content);
    const tasks = this._extractTasks(content);
    const links = this._extractLinks(content);

    return {
      headings,
      summary: this._generateSummary(content, headings),
      stats: {
        wordCount: this._countWords(content),
        taskCount: tasks.length,
        linkCount: links.length
      }
    };
  }

  /**
   * 提取标题
   */
  private _extractHeadings(content: string): Heading[] {
    const headings: Heading[] = [];
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      const match = line.match(/^(#{1,6})\s+(.+)$/);
      if (match) {
        headings.push({
          level: match[1].length,
          text: match[2].trim(),
          line: index + 1
        });
      }
    });

    return headings;
  }

  /**
   * 提取任务
   */
  private _extractTasks(content: string): any[] {
    const tasks: any[] = [];
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      const match = line.match(/^[\s-]*\[([x\s])\]\s+(.+)$/i);
      if (match) {
        tasks.push({
          completed: match[1].toLowerCase() === 'x',
          text: match[2].trim(),
          line: index + 1
        });
      }
    });

    return tasks;
  }

  /**
   * 提取链接
   */
  private _extractLinks(content: string): any[] {
    const links: any[] = [];
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    
    let match;
    while ((match = linkRegex.exec(content)) !== null) {
      links.push({
        text: match[1],
        url: match[2]
      });
    }

    return links;
  }

  /**
   * 生成摘要
   */
  private _generateSummary(content: string, headings: Heading[]): string {
    // 使用第一个段落或第一个标题作为摘要
    if (headings.length > 0) {
      return headings[0].text;
    }

    const lines = content.split('\n').filter(l => l.trim());
    if (lines.length > 0) {
      const firstPara = lines[0].substring(0, 100);
      return firstPara.length < lines[0].length ? firstPara + '...' : firstPara;
    }

    return '';
  }

  /**
   * 统计字数
   */
  private _countWords(text: string): number {
    // 移除 Markdown 语法
    const cleaned = text
      .replace(/```[\s\S]*?```/g, '') // 代码块
      .replace(/`[^`]+`/g, '') // 行内代码
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // 链接
      .replace(/[#*_~`]/g, ''); // Markdown 符号

    return cleaned.trim().split(/\s+/).filter(Boolean).length;
  }
}
