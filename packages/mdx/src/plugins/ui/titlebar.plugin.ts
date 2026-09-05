/**
 * @file mdx/plugins/ui/titlebar.plugin.ts
 */

import type { MDxPlugin, PluginContext } from '../../core/types';
import type { MDxEditor } from '../../editor/mdx-editor';
import type { PluginManager } from '../../core/plugin-manager';
import { buildRenamedFilename } from '@itookit/common';
import type { IModuleFS } from '@itookit/vfs-core';

const replaceBasename = (path: string, filename: string): string => {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? `${path.slice(0, slash + 1)}${filename}` : path;
};

const renameWithStoredTitle = async (
  engine: IModuleFS,
  nodeId: string,
  filename: string,
  title: string,
): Promise<void> => {
  const node = await engine.driver.getNode(nodeId);
  const oldTitle = typeof node?.metadata?.title === 'string'
    ? node.metadata.title
    : null;
  if (oldTitle !== null) await engine.driver.updateMetadata(nodeId, { title });
  try {
    await engine.driver.rename(nodeId, filename);
  } catch (error) {
    if (oldTitle !== null) {
      await engine.driver.updateMetadata(nodeId, { title: oldTitle }).catch(() => { });
    }
    throw error;
  }
};

/**
 * 标题栏插件配置选项
 */
export interface CoreTitleBarPluginOptions {
  /**
   * 是否启用编辑/阅读模式切换按钮
   * @default false
   */
  enableToggleEditMode?: boolean;

  /**
   * 是否启用附件管理功能
   * 如果为 true，工厂函数会自动加载 ui:asset-manager 插件
   * @default true
   */
  enableAssetManager?: boolean;

  /**
   * 切换侧边栏回调函数
   */
  onSidebarToggle?: (editor: MDxEditor) => void;

  /**
   * AI 功能回调函数
   */
  aiCallback?: (editor: MDxEditor) => void | Promise<void>;

  /**
   * 保存回调函数
   */
  saveCallback?: (editor: MDxEditor) => void | Promise<void>;

  /**
   * 自定义打印回调函数
   */
  printCallback?: (editor: MDxEditor) => void;
}

/**
 * 标题栏核心插件
 */
export class CoreTitleBarPlugin implements MDxPlugin {
  name = 'core:titlebar';
  private options: CoreTitleBarPluginOptions;
  private cleanupFns: Array<() => void> = [];
  private toggleModeBtn: HTMLButtonElement | null = null;
  private titleEl: HTMLInputElement | null = null;
  private fileExt: string = '';
  private currentTitle: string = '';

  constructor(options: CoreTitleBarPluginOptions = {}) {
    this.options = options;
  }

  install(context: PluginContext): void {
    const removeSetTitleListener = context.listen('setTitle', ({ title }: { title: string }) => {
      if (this.titleEl) {
        this.titleEl.value = title;
        this.currentTitle = title;
      }
    });
    if (removeSetTitleListener) {
      this.cleanupFns.push(removeSetTitleListener);
    }

    const removeRegister = context.on('editorPostInit', (payload: {
      editor: MDxEditor,
      pluginManager: PluginManager
    }) => {
      this.registerButtons(context, payload);
    });

    if (removeRegister) {
      this.cleanupFns.push(removeRegister);
    }

    const removeRender = context.on('editorPostInit', (payload: {
      editor: MDxEditor,
      pluginManager: PluginManager
    }) => {
      this.renderTitleBar(context, payload);
    });

    if (removeRender) {
      this.cleanupFns.push(removeRender);
    }

    const removeModeChange = context.on('modeChanged', ({ mode }: { mode: 'edit' | 'render' }) => {
      this.updateModeButton(mode);
    });

    if (removeModeChange) {
      this.cleanupFns.push(removeModeChange);
    }
  }

  /**
   * 注册按钮
   */
  private registerButtons(context: PluginContext, payload: {
    editor: MDxEditor,
    pluginManager: PluginManager
  }): void {
    const { editor } = payload;

    if (this.options.onSidebarToggle) {
      context.registerTitleBarButton?.({
        id: 'toggle-sidebar',
        title: '切换侧边栏',
        icon: '<i class="fas fa-bars"></i>',
        location: 'left',
        onClick: () => this.options.onSidebarToggle?.(editor),
      });
    }

    if (this.options.enableToggleEditMode) {
      context.registerCommand?.('toggleEditMode', (editor: MDxEditor) => {
        const currentMode = editor.getMode();
        const newMode = currentMode === 'edit' ? 'render' : 'edit';
        editor.switchToMode(newMode);
      });

      context.registerTitleBarButton?.({
        id: 'toggle-edit-mode',
        title: '切换到阅读模式',
        icon: '<i class="fas fa-book-open"></i>',
        command: 'toggleEditMode',
        location: 'left',
      });
    }

    if (this.options.aiCallback) {
      context.registerCommand?.('triggerAI', async (editor: MDxEditor) => {
        await this.options.aiCallback?.(editor);
      });

      context.registerTitleBarButton?.({
        id: 'ai-action',
        title: 'AI 助手',
        icon: '<i class="fas fa-magic"></i>',
        command: 'triggerAI',
        location: 'right',
      });
    }

    if (this.options.saveCallback) {
      context.registerCommand?.('triggerSave', async (editor: MDxEditor) => {
        await this.options.saveCallback?.(editor);
      });

      context.registerTitleBarButton?.({
        id: 'save-action',
        title: '保存',
        icon: '<i class="fas fa-save"></i>',
        command: 'triggerSave',
        location: 'right',
      });
    }

    const printCallback = this.options.printCallback || this.defaultPrintHandler;
    context.registerCommand?.('handlePrintAction', printCallback);

    context.registerTitleBarButton?.({
      id: 'print-action',
      title: '打印',
      icon: '<i class="fas fa-print"></i>',
      command: 'handlePrintAction',
      location: 'right',
    });
  }

  /**
   * 渲染标题栏
   */
  private renderTitleBar(context: PluginContext, payload: {
    editor: MDxEditor,
    pluginManager: PluginManager
  }): void {
    const { editor, pluginManager } = payload;
    const container = editor.container;
    if (!container) return;

    let titleBar = container.querySelector('.mdx-editor-titlebar') as HTMLElement;
    if (!titleBar) {
      titleBar = document.createElement('div');
      titleBar.className = 'mdx-editor-titlebar';
      container.insertBefore(titleBar, container.firstChild);
    }

    const leftGroup = document.createElement('div');
    leftGroup.className = 'mdx-editor-titlebar__left';

    const titleContainer = document.createElement('div');
    titleContainer.className = 'mdx-editor-titlebar__center';
    this.fileExt = (editor.config.language as string) || '';
    this.currentTitle = editor.config.title || '';
    this.titleEl = document.createElement('input');
    this.titleEl.type = 'text';
    this.titleEl.className = 'mdx-editor-titlebar__title';
    this.titleEl.value = this.currentTitle;
    this.titleEl.spellcheck = false;

    const doRename = async () => {
      const newTitle = this.titleEl!.value.trim();
      if (!newTitle || newTitle === this.currentTitle) {
        this.titleEl!.value = this.currentTitle;
        return;
      }
      const { filename: finalName, title } = buildRenamedFilename(
        newTitle,
        this.currentTitle + this.fileExt,
      );
      const engine = context.getModuleFS?.();
      const nodeId = context.getCurrentNodeId();
      if (!engine || !nodeId) {
        this.titleEl!.value = this.currentTitle;
        return;
      }
      try {
        await renameWithStoredTitle(engine, nodeId, finalName, title);
        editor.updateNodeId(replaceBasename(nodeId, finalName));
        this.currentTitle = title;
        this.titleEl!.value = title;
      } catch {
        this.titleEl!.value = this.currentTitle;
      }
    };

    this.titleEl.addEventListener('blur', doRename);
    this.titleEl.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.titleEl!.blur();
      } else if (e.key === 'Escape') {
        this.titleEl!.value = this.currentTitle;
        this.titleEl!.blur();
      }
    });

    titleContainer.appendChild(this.titleEl);

    const rightGroup = document.createElement('div');
    rightGroup.className = 'mdx-editor-titlebar__right';

    // 使用 DocumentFragment 批量添加按钮
    const leftFragment = document.createDocumentFragment();
    const rightFragment = document.createDocumentFragment();

    const buttons = pluginManager.getTitleBarButtons();

    buttons.forEach(btnConfig => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mdx-editor-titlebar__button';
      button.title = btnConfig.title || btnConfig.id;
      button.setAttribute('data-button-id', btnConfig.id);

      if (typeof btnConfig.icon === 'string') {
        button.innerHTML = btnConfig.icon;
      } else if (btnConfig.icon instanceof HTMLElement) {
        button.appendChild(btnConfig.icon.cloneNode(true));
      }

      button.onclick = async () => {
        try {
          if (btnConfig.onClick) {
            await btnConfig.onClick({ editor, context, pluginManager });
          } else if (btnConfig.command) {
            const command = pluginManager.getCommand(btnConfig.command);
            if (command) await command(editor);
          }
        } catch (error) {
          console.error(`[TitleBarPlugin] Button "${btnConfig.id}" failed:`, error);
        }
      };

      // 添加到对应的 Fragment
      if (btnConfig.location === 'right') {
        rightFragment.appendChild(button);
      } else {
        leftFragment.appendChild(button);
      }

      if (btnConfig.id === 'toggle-edit-mode') {
        this.toggleModeBtn = button;
      }
    });

    // 一次性添加所有按钮
    leftGroup.appendChild(leftFragment);
    rightGroup.appendChild(rightFragment);

    // 清空并重建标题栏
    titleBar.innerHTML = '';
    titleBar.appendChild(leftGroup);
    titleBar.appendChild(titleContainer);
    titleBar.appendChild(rightGroup);

    if (buttons.length === 0 && !this.titleEl.value) {
      titleBar.style.display = 'none';
    } else {
      titleBar.style.display = '';
    }
  }

  /**
   * 更新模式切换按钮
   */
  private updateModeButton(mode: 'edit' | 'render'): void {
    if (!this.toggleModeBtn) return;

    if (mode === 'edit') {
      this.toggleModeBtn.title = '切换到阅读模式';
      this.toggleModeBtn.innerHTML = '<i class="fas fa-book-open"></i>';
    } else {
      this.toggleModeBtn.title = '切换到编辑模式';
      this.toggleModeBtn.innerHTML = '<i class="fas fa-edit"></i>';
    }
  }

  /**
   * 默认打印处理函数
   */
  private defaultPrintHandler(editor: MDxEditor): void {
    editor.print({
      title: editor.config.title || 'Document',
      showHeader: true,
      headerMeta: {
        date: new Date().toLocaleDateString(),
      },
    }).catch(err => {
      console.error('[TitleBarPlugin] Print failed:', err);
    });
  }

  destroy(): void {
    this.cleanupFns.forEach(fn => fn());
    this.cleanupFns = [];
    this.toggleModeBtn = null;
    this.titleEl = null;
    this.fileExt = '';
    this.currentTitle = '';
  }
}
