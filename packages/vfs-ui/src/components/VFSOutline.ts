/**
 * @file vfs-ui/components/VFSOutline.ts
 */
import { VNode } from '@itookit/vfs-core';
import type { ContentMetadata, Heading } from '../interfaces/IVFSUIManager';

interface OutlineOptions {
  container: HTMLElement;
  onHeadingClick?: (line: number) => void;
}

export class VFSOutline {
  private container: HTMLElement;
  private currentNode: VNode | null = null;
  private metadata: ContentMetadata | null = null;
  private onHeadingClick?: (line: number) => void;

  constructor(options: OutlineOptions) {
    this.container = options.container;
    this.onHeadingClick = options.onHeadingClick;
    this._bindEvents();
  }

  /**
   * 更新大纲
   */
  update(node: VNode, metadata: ContentMetadata): void {
    this.currentNode = node;
    this.metadata = metadata;
    this.render();
  }

  /**
   * 清空大纲
   */
  clear(): void {
    this.currentNode = null;
    this.metadata = null;
    this.render();
  }

  /**
   * 渲染
   */
  render(): void {
    if (!this.metadata || !this.metadata.headings || this.metadata.headings.length === 0) {
      this.container.innerHTML = `
        <div class="vfs-outline-empty">
          <span class="empty-icon">📄</span>
          <span class="empty-text">No outline available</span>
        </div>
      `;
      return;
    }

    const html = `
      <div class="vfs-outline">
        <div class="outline-header">
          <h3>Outline</h3>
          ${this._renderStats()}
        </div>
        <div class="outline-content">
          ${this._renderHeadings(this.metadata.headings)}
        </div>
      </div>
    `;

    this.container.innerHTML = html;
  }

  /**
   * 渲染统计信息
   */
  private _renderStats(): string {
    if (!this.metadata?.stats) return '';

    const stats: string[] = [];

    if (this.metadata.stats.wordCount !== undefined) {
      stats.push(`${this.metadata.stats.wordCount} words`);
    }

    if (this.metadata.stats.clozeCount) {
      stats.push(`${this.metadata.stats.clozeCount} clozes`);
    }

    if (this.metadata.stats.taskCount) {
      stats.push(`${this.metadata.stats.taskCount} tasks`);
    }

    if (stats.length === 0) return '';

    return `
      <div class="outline-stats">
        ${stats.join(' · ')}
      </div>
    `;
  }

  /**
   * 渲染标题列表
   */
  private _renderHeadings(headings: Heading[]): string {
    return headings.map(heading => `
      <div class="outline-item level-${heading.level}" 
           data-line="${heading.line}"
           style="padding-left: ${(heading.level - 1) * 12}px">
        <span class="heading-marker">${'#'.repeat(heading.level)}</span>
        <span class="heading-text">${this._escapeHtml(heading.text)}</span>
      </div>
    `).join('');
  }

  /**
   * 绑定事件
   */
  private _bindEvents(): void {
    this.container.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const item = target.closest('.outline-item');
      
      if (item && this.onHeadingClick) {
        const line = parseInt((item as HTMLElement).dataset.line || '0');
        this.onHeadingClick(line);
      }
    });
  }

  /**
   * HTML 转义
   */
  private _escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * 销毁
   */
  destroy(): void {
    this.container.innerHTML = '';
  }
}
