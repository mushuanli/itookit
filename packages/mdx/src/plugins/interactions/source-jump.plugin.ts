// mdx/plugins/interactions/source-jump.plugin.ts

import type { MDxPlugin, PluginContext } from '../../core/plugin';

/**
 * 源码同步插件
 */
export class SourceSyncPlugin implements MDxPlugin {
  name = 'interaction:source-sync';
  private cleanupFns: Array<() => void> = [];

  install(context: PluginContext): void {
    const removeDomUpdated = context.on('domUpdated', ({ element }: { element: HTMLElement }) => {
      this.attachDoubleClickHandler(element, context);
    });

    if (removeDomUpdated) {
      this.cleanupFns.push(removeDomUpdated);
    }
  }

  /**
   * 附加双击事件处理器
   */
  private attachDoubleClickHandler(element: HTMLElement, context: PluginContext): void {
    const existingHandler = (element as any)._sourceSyncHandler;
    if (existingHandler) {
      element.removeEventListener('dblclick', existingHandler);
    }

    const handler = (event: MouseEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const isModifierPressed = isMac ? event.metaKey : event.ctrlKey;

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
    (element as any)._sourceSyncHandler = handler;
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
    const blockTags = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE', 'PRE', 'DIV'];
    let current: HTMLElement | null = element;

    while (current && current !== document.body) {
      if (blockTags.includes(current.tagName)) {
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
