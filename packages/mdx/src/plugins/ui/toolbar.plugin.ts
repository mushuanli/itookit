// mdx/plugins/ui/toolbar.plugin.ts

import type { MDxPlugin, PluginContext, ToolbarButtonConfig } from '../../core/types';
import type { MDxEditor } from '../../editor/mdx-editor';
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
   * [优化] 构建工具栏 - 使用 DocumentFragment 和事件委托
   */
  private buildToolbar(context: PluginContext, payload: {
    editor: MDxEditor,
    pluginManager: PluginManager
  }): void {
    const { editor, pluginManager } = payload;

    const editorRootContainer = editor.container;
    if (!editorRootContainer) {
      console.warn('ToolbarPlugin: Container not found.');
      return;
    }

    let toolbarContainer = editorRootContainer.querySelector(
      `.${this.options.className}`
    ) as HTMLElement;

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

    this.bindButtonGroup(mainGroup, mainButtons, context, editor, pluginManager);

    toolbarContainer.appendChild(mainGroup);

    // 使用 DocumentFragment 批量添加按钮
    const mainFragment = document.createDocumentFragment();
    for (const btnConfig of mainButtons) {
      const btn = this.createButton(btnConfig);
      mainFragment.appendChild(btn);
    }
    mainGroup.appendChild(mainFragment);

    // 模式切换按钮组
    if (modeSwitcherButtons.length > 0) {
      const modeSwitcherGroup = document.createElement('div');
      modeSwitcherGroup.className = `${this.options.className}__mode-switcher`;

      this.bindButtonGroup(modeSwitcherGroup, modeSwitcherButtons, context, editor, pluginManager);

      toolbarContainer.appendChild(modeSwitcherGroup);

      const modeFragment = document.createDocumentFragment();
      for (const btnConfig of modeSwitcherButtons) {
        const btn = this.createButton(btnConfig);
        modeFragment.appendChild(btn);
      }
      modeSwitcherGroup.appendChild(modeFragment);
    }
  }

  /**
   * [优化] 创建按钮 - 不再绑定单独事件
   */
  private createButton(config: ToolbarButtonConfig): HTMLElement {
    if (config.type === 'separator') {
      const separator = document.createElement('div');
      separator.className = `${this.options.className}__separator`;
      return separator;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = `${this.options.className}__button`;
    button.title = config.title || config.id;
    button.setAttribute('data-button-id', config.id);
    if (config.command) button.setAttribute('data-command', config.command);

    if (typeof config.icon === 'string') {
      button.innerHTML = config.icon;
    } else if (config.icon instanceof HTMLElement) {
      button.appendChild(config.icon.cloneNode(true));
    }

    return button;
  }

  private bindButtonGroup(
    group: HTMLElement,
    configs: ToolbarButtonConfig[],
    context: PluginContext,
    editor: MDxEditor,
    pluginManager: PluginManager,
  ): void {
    group.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (button) void this.runButton(button, configs, context, editor, pluginManager);
    });
  }

  private async runButton(
    button: HTMLButtonElement,
    configs: ToolbarButtonConfig[],
    context: PluginContext,
    editor: MDxEditor,
    pluginManager: PluginManager,
  ): Promise<void> {
    const id = button.dataset.buttonId;
    const config = configs.find(item => item.type !== 'separator' && item.id === id);
    if (!config || config.type === 'separator') return;

    try {
      if (config.onClick) {
        await config.onClick({ editor, context, pluginManager });
        return;
      }
      const command = config.command && pluginManager.getCommand(config.command);
      const view = editor.getEditorView();
      if (command && view) await command(view);
    } catch (error) {
      console.error(`[ToolbarPlugin] Button "${config.id}" failed:`, error);
    }
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
