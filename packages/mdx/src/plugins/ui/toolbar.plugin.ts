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
    // 监听编辑器初始化完成事件
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

    // 1. 获取编辑器的主容器，这个容器就是会被添加 is-edit-mode/is-render-mode 的元素
    const editorRootContainer = editor.container; 
    if (!editorRootContainer) {
      console.warn('ToolbarPlugin: MDxEditor container not found. Cannot build toolbar.');
      return;
    }

    // 2. 检查工具栏是否已存在，如果不存在则创建
    let toolbarContainer = editorRootContainer.querySelector(`.${this.options.className}`) as HTMLElement;
    if (!toolbarContainer) {
      toolbarContainer = document.createElement('div');
      toolbarContainer.className = this.options.className;
      
      // 3. 将工具栏作为第一个子元素插入到编辑器主容器中
      editorRootContainer.insertBefore(toolbarContainer, editorRootContainer.firstChild);
    }
    
    this.toolbarElement = toolbarContainer;
    
    // 从插件管理器获取注册的按钮配置
    const buttons = pluginManager.getToolbarButtons();

    // 清空容器，以便重新渲染（如果需要）
    toolbarContainer.innerHTML = '';

    // 按 location 分组
    const mainButtons = buttons.filter((b: ToolbarButtonConfig) => 
      !b.location || b.location === 'main'
    );
    const modeSwitcherButtons = buttons.filter((b: ToolbarButtonConfig) => 
      b.location === 'mode-switcher'
    );

    // 创建主工具栏区域
    const mainGroup = document.createElement('div');
    mainGroup.className = `${this.options.className}__main`;
    toolbarContainer.appendChild(mainGroup);

    // 创建按钮
    mainButtons.forEach((btnConfig: ToolbarButtonConfig) => {
      const btn = this.createButton(btnConfig, context, editor, pluginManager);
      mainGroup.appendChild(btn);
    });

    // 创建模式切换区域
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
    editor: MDxEditor, // 明确类型
    pluginManager: PluginManager // 明确类型
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

    // 设置图标
    if (typeof config.icon === 'string') {
      button.innerHTML = config.icon;
    } else if (config.icon instanceof HTMLElement) {
      button.appendChild(config.icon.cloneNode(true));
    }

    // 绑定点击事件
    button.onclick = () => {
      if (config.onClick) {
        config.onClick({ editor, context, pluginManager });
      } else if (config.command) {
        // 从命令注册表中查找并执行命令
        const command = pluginManager.getCommand(config.command);
        const view = editor.getEditorView();
        if (command && view) {
          command(view); // ✅ 修正：传递 view 而不是 editor
        } else {
          console.warn(`Command "${config.command}" not found or editor view is not available.`);
        }
      }
    };

    return button;
  }

  destroy(): void {
    // 因为工具栏现在是 editor.container 的一部分，
    // 当 editor.destroy() 清理 container 时，工具栏也会被自动移除。
    // 我们只需确保移除我们自己添加的事件监听器（如果有的话）。
    if (this.toolbarElement) {
        this.toolbarElement.remove(); // 显式移除以确保干净
    }
    this.toolbarElement = null;
    
    this.cleanupFns.forEach(fn => fn());
    this.cleanupFns = [];
  }
}
