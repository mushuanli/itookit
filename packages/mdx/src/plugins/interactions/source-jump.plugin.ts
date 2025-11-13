// mdx/plugins/interactions/source-jump.plugin.ts

import type { MDxPlugin, PluginContext } from '../../core/plugin';
import type { MDxEditor } from '../../editor/editor';

/**
 * 源码同步插件
 */
export class SourceSyncPlugin implements MDxPlugin {
  name = 'interaction:source-sync';
  private cleanupFns: Array<() => void> = [];

  install(context: PluginContext): void {
    // 监听 DOM 更新事件
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
    // 移除旧的处理器（如果存在）
    const existingHandler = (element as any)._sourceSyncHandler;
    if (existingHandler) {
      element.removeEventListener('dblclick', existingHandler);
    }

    // 创建新的处理器
    const handler = (event: MouseEvent) => {
      // 检查是否按下了 Ctrl/Cmd 键
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

    // 附加处理器
    element.addEventListener('dblclick', handler);
    (element as any)._sourceSyncHandler = handler;
  }

  /**
   * 提取要查找的文本
   */
  private extractText(target: HTMLElement): string | null {
    // 优先级 1: Cloze 元素
    const clozeElement = target.closest('.cloze');
    if (clozeElement) {
      const clozeContent = clozeElement.getAttribute('data-cloze-content');
      if (clozeContent) {
        return clozeContent;
      }
    }

    // 优先级 2: 用户选择的文本
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim();
    if (selectedText) {
      return selectedText;
    }

    // 优先级 3: 块级元素文本
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
