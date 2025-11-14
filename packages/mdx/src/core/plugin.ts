// mdx/core/plugin.ts
import type { Extension } from '@codemirror/state';
import type { Marked, MarkedExtension } from 'marked';
import type { IPersistenceAdapter } from '@itookit/common';
import type { VFSCore } from '@itookit/vfs-core';
import type { PluginManager } from './plugin-manager';

/**
 * 作用域持久化存储接口
 */
export interface ScopedPersistenceStore {
  get(key: string): Promise<any>;
  set(key: string, value: any): Promise<void>;
  remove(key: string): Promise<void>;
}

/**
 * 通用按钮配置（必须有图标）
 */
interface IToolbarButton {
  id: string;
  type?: 'button';
  title?: string;
  icon: string | HTMLElement;
  command?: string;
  onClick?: (context: any) => void;
  location?: 'main' | 'mode-switcher';
}

/**
 * 分隔符配置（没有图标）
 */
interface IToolbarSeparator {
  id: string;
  type: 'separator';
  location?: 'main' | 'mode-switcher';
}

/**
 * 工具栏按钮配置 - 联合类型
 * 它可以是一个 IToolbarButton 或者一个 IToolbarSeparator
 */
export type ToolbarButtonConfig = IToolbarButton | IToolbarSeparator;


/**
 * 标题栏按钮配置
 */
export interface TitleBarButtonConfig {
  id: string;
  title?: string;
  // 这将允许图标既可以是 SVG 字符串，也可以是一个 DOM 元素对象。
  icon: string | HTMLElement;
  command?: string;
  onClick?: (context: any) => void;
  location?: 'left' | 'right';
}

/**
 * 插件上下文接口
 */
export interface PluginContext {
  readonly pluginManager: PluginManager; 

  // 语法扩展
  registerSyntaxExtension(ext: MarkedExtension): void;
  
  // 💡 新增：为编辑器注册 CodeMirror 扩展
  registerCodeMirrorExtension?(extension: Extension | Extension[]): void;

  // 生命周期钩子
  on(hook: string, callback: Function): () => void;
  
  // 依赖注入
  provide(key: string | symbol, service: any): void;
  inject(key: string | symbol): any;
  
  // 事件总线
  emit(eventName: string, payload: any): void;
  listen(eventName: string, callback: Function): () => void;
  
  // 持久化存储
  getScopedStore(): ScopedPersistenceStore;
  
  // VFS 集成 - 增强类型
  getVFSCore(): VFSCore | null;
  getCurrentNodeId(): string | null;
  
  // 编辑器专用（仅在 MDxEditor 中可用）
  registerCommand?(name: string, fn: Function): void;
  registerToolbarButton?(config: ToolbarButtonConfig): void;
  registerTitleBarButton?(config: TitleBarButtonConfig): void;
  renderInElement?(element: HTMLElement, markdown: string): Promise<void>;
  findAndSelectText?(text: string): void;
  switchToMode?(mode: 'edit' | 'render'): void;
  /**
   * @internal
   * 由 PluginManager 内部使用，用于在插件卸载时进行资源清理。
   * 插件开发者不应直接调用此方法。
   */
  _cleanup?(): void;
}

/**
 * 插件接口
 */
export interface MDxPlugin {
  name: string;
  install(context: PluginContext): void;
  destroy?(): void;
}

/**
 * 钩子数据类型
 */
export interface HookData {
  beforeParse?: {
    markdown: string;
    options: Record<string, any>;
  };
  afterRender?: {
    html: string;
    options: Record<string, any>;
  };
  domUpdated?: {
    element: HTMLElement;
    options: Record<string, any>;renderer: any;
  };
}

