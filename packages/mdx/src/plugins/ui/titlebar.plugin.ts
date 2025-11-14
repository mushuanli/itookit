// mdx/plugins/ui/titlebar.plugin.ts

import type { MDxPlugin, PluginContext, TitleBarButtonConfig } from '../../core/plugin';
import type { MDxEditor } from '../../editor/editor';
import type { PluginManager } from '../../core/plugin-manager';

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
   * 切换侧边栏回调函数
   */
  toggleSidebarCallback?: (editor: MDxEditor) => void;

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

  constructor(options: CoreTitleBarPluginOptions = {}) {
    this.options = options;
  }

  install(context: PluginContext): void {
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

    if (this.options.toggleSidebarCallback) {
      context.registerTitleBarButton?.({
        id: 'toggle-sidebar',
        title: '切换侧边栏',
        icon: '<i class="fas fa-bars"></i>',
        location: 'left',
        onClick: () => this.options.toggleSidebarCallback?.(editor),
      });
    }

    if (this.options.enableToggleEditMode) {
      context.registerCommand?.('toggleEditMode', (editor: MDxEditor) => {
        const currentMode = editor.getCurrentMode();
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
    
    const rightGroup = document.createElement('div');
    rightGroup.className = 'mdx-editor-titlebar__right';

    titleBar.innerHTML = '';
    titleBar.appendChild(leftGroup);
    titleBar.appendChild(rightGroup);

    const buttons = pluginManager.getTitleBarButtons();

    buttons.forEach(btnConfig => {
      const button = document.createElement('button');
      button.className = 'mdx-editor-titlebar__button';
      button.title = btnConfig.title || btnConfig.id;
      button.setAttribute('data-button-id', btnConfig.id);

      if (typeof btnConfig.icon === 'string') {
        button.innerHTML = btnConfig.icon;
      } else if (btnConfig.icon instanceof HTMLElement) {
        button.appendChild(btnConfig.icon.cloneNode(true));
      }

      button.onclick = () => {
        if (btnConfig.onClick) {
          btnConfig.onClick({ editor, context, pluginManager });
        } else if (btnConfig.command) {
          const command = pluginManager.getCommand(btnConfig.command);
          if (command) {
            command(editor);
          }
        }
      };

      const targetGroup = btnConfig.location === 'right' ? rightGroup : leftGroup;
      targetGroup.appendChild(button);
      
      if (btnConfig.id === 'toggle-edit-mode') {
        this.toggleModeBtn = button;
      }
    });

    if (buttons.length === 0) {
      titleBar.style.display = 'none';
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
    const renderContainer = editor.getRenderContainer();
    if (!renderContainer) {
      console.warn('Render container not found for printing');
      return;
    }

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>打印预览</title>
          <style>
            body { font-family: sans-serif; padding: 20px; }
            /* 复制编辑器样式 */
          </style>
        </head>
        <body>
          ${renderContainer.innerHTML}
        </body>
      </html>
    `);

    printWindow.document.close();
    printWindow.print();
  }

  destroy(): void {
    this.cleanupFns.forEach(fn => fn());
    this.cleanupFns = [];
    this.toggleModeBtn = null;
  }
}
