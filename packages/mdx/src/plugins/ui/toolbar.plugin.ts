// mdx/plugins/ui/toolbar.plugin.ts

import type { MDxPlugin, PluginContext, ToolbarButtonConfig } from '../../core/plugin';
import type { MDxEditor } from '../../editor/editor';
import type { PluginManager } from '../../core/plugin-manager';

/**
 * 工具栏插件配置选项
 */
export interface ToolbarPluginOptions {
  /**
   * 自定义工具栏类名
   * @default 'mdx-editor-toolbar'
   */
  className?: string;
}

/**
 * 工具栏插件
 */
export class ToolbarPlugin implements MDxPlugin {
  name = 'ui:toolbar';
  private options: Required<Omit<ToolbarPluginOptions, 'container' | 'autoCreate'>>;
  private toolbarElement: HTMLElement | null = null;
  private cleanupFns: Array<() => void> = [];

  constructor(options: ToolbarPluginOptions = {}) {
    this.options = {
      className: options.className || 'mdx-editor-toolbar',
    };
  }

  install(context: PluginContext): void {
    const removeEditorPostInit = context.on('editorPostInit', (payload: { editor: MDxEditor, pluginManager: PluginManager }) => {
      this.buildToolbar(context, payload);
    });

    if (removeEditorPostInit) {
      this.cleanupFns.push(removeEditorPostInit);
    }
  }

  /**
   * 构建工具栏
   */
  private buildToolbar(context: PluginContext, payload: { editor: MDxEditor, pluginManager: PluginManager }): void {
    const { editor, pluginManager } = payload;

    const editorRootContainer = editor.container; 
    if (!editorRootContainer) {
      console.warn('ToolbarPlugin: MDxEditor container not found. Cannot build toolbar.');
      return;
    }

    let toolbarContainer = editorRootContainer.querySelector(`.${this.options.className}`) as HTMLElement;
    if (!toolbarContainer) {
      toolbarContainer = document.createElement('div');
      toolbarContainer.className = this.options.className;
      
      editorRootContainer.insertBefore(toolbarContainer, editorRootContainer.firstChild);
    }
    
    this.toolbarElement = toolbarContainer;
    
    const buttons = pluginManager.getToolbarButtons();

    toolbarContainer.innerHTML = '';

    const mainButtons = buttons.filter((b: ToolbarButtonConfig) => 
      !b.location || b.location === 'main'
    );
    const modeSwitcherButtons = buttons.filter((b: ToolbarButtonConfig) => 
      b.location === 'mode-switcher'
    );

    const mainGroup = document.createElement('div');
    mainGroup.className = `${this.options.className}__main`;
    toolbarContainer.appendChild(mainGroup);

    mainButtons.forEach((btnConfig: ToolbarButtonConfig) => {
      const btn = this.createButton(btnConfig, context, editor, pluginManager);
      mainGroup.appendChild(btn);
    });

    if (modeSwitcherButtons.length > 0) {
      const modeSwitcherGroup = document.createElement('div');
      modeSwitcherGroup.className = `${this.options.className}__mode-switcher`;
      toolbarContainer.appendChild(modeSwitcherGroup);

      modeSwitcherButtons.forEach((btnConfig: ToolbarButtonConfig) => {
        const btn = this.createButton(btnConfig, context, editor, pluginManager);
        modeSwitcherGroup.appendChild(btn);
      });
    }
  }

  /**
   * 创建按钮元素
   */
  private createButton(
    config: ToolbarButtonConfig,
    context: PluginContext,
    editor: MDxEditor,
    pluginManager: PluginManager
  ): HTMLElement {
    if (config.type === 'separator') {
      const separator = document.createElement('div');
      separator.className = `${this.options.className}__separator`;
      return separator;
    }

    const button = document.createElement('button');
    button.className = `${this.options.className}__button`;
    button.title = config.title || config.id;
    button.setAttribute('data-command', config.id);

    if (typeof config.icon === 'string') {
      button.innerHTML = config.icon;
    } else if (config.icon instanceof HTMLElement) {
      button.appendChild(config.icon.cloneNode(true));
    }

    button.onclick = () => {
      if (config.onClick) {
        config.onClick({ editor, context, pluginManager });
      } else if (config.command) {
        const command = pluginManager.getCommand(config.command);
        const view = editor.getEditorView();
        if (command && view) {
          command(view);
        } else {
          console.warn(`Command "${config.command}" not found or editor view is not available.`);
        }
      }
    };

    return button;
  }

  destroy(): void {
    if (this.toolbarElement) {
        this.toolbarElement.remove();
    }
    this.toolbarElement = null;
    
    this.cleanupFns.forEach(fn => fn());
    this.cleanupFns = [];
  }
}
