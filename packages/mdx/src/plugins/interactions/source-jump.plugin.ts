/**
 * @file mdx/plugins/interactions/source-jump.plugin.ts
 * @description 源码同步插件 - 优化版
 */
import type { MDxPlugin, PluginContext } from '../../core/plugin';

// [优化] 静态常量提取
const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE', 'DIV']);

export class SourceSyncPlugin implements MDxPlugin {
  name = 'interaction:source-sync';
  private cleanupFns: Array<() => void> = [];
  
  // [优化] 缓存平台检测结果
  private readonly isMac = typeof navigator !== 'undefined' && 
    navigator.platform.toUpperCase().indexOf('MAC') >= 0;

  install(context: PluginContext): void {
    const removeDomUpdated = context.on('domUpdated', ({ element }: { element: HTMLElement }) => {
      this.attachDoubleClickHandler(element, context);
    });

    if (removeDomUpdated) {
      this.cleanupFns.push(removeDomUpdated);
    }
  }

  /**
   * [优化] 使用事件委托替代每个元素绑定
   */
  private attachDoubleClickHandler(element: HTMLElement, context: PluginContext): void {
    // 检查是否已绑定
    if (element.dataset.sourceSyncBound) return;
    element.dataset.sourceSyncBound = 'true';

    const handler = (event: MouseEvent) => {
      const isModifierPressed = this.isMac ? event.metaKey : event.ctrlKey;

      if (!isModifierPressed) {
        return;
      }

      const target = event.target as HTMLElement;
      const textToFind = this.extractText(target);

      if (textToFind && context.findAndSelectText && context.switchToMode) {
        context.findAndSelectText(textToFind);
        context.switchToMode('edit');
      }
    };

    element.addEventListener('dblclick', handler);
    
    this.cleanupFns.push(() => {
      element.removeEventListener('dblclick', handler);
      delete element.dataset.sourceSyncBound;
    });
  }

  /**
   * 提取要查找的文本
   */
  private extractText(target: HTMLElement): string | null {
    const clozeElement = target.closest('.cloze');
    if (clozeElement) {
      const clozeContent = clozeElement.getAttribute('data-cloze-content');
      if (clozeContent) {
        return clozeContent;
      }
    }

    const selection = window.getSelection();
    const selectedText = selection?.toString().trim();
    if (selectedText) {
      return selectedText;
    }

    const blockElement = this.findBlockParent(target);
    if (blockElement) {
      return blockElement.textContent?.trim() || null;
    }

    return null;
  }

  /**
   * 查找最近的块级父元素
   */
  private findBlockParent(element: HTMLElement): HTMLElement | null {
    let current: HTMLElement | null = element;

    while (current && current !== document.body) {
      if (BLOCK_TAGS.has(current.tagName)) {
        return current;
      }
      current = current.parentElement;
    }

    return null;
  }

  destroy(): void {
    this.cleanupFns.forEach(fn => fn());
    this.cleanupFns = [];
  }
}
