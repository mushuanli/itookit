import type { Marked, MarkedExtension } from 'marked';

/**
 * 作用域持久化存储接口
 */
export interface ScopedPersistenceStore {
  get(key: string): Promise<any>;
  set(key: string, value: any): Promise<void>;
  remove(key: string): Promise<void>;
}

/**
 * 工具栏按钮配置
 */
export interface ToolbarButtonConfig {
  id: string;
  title?: string;
  icon: string | HTMLElement;
  command?: string;
  onClick?: (context: any) => void;
  location?: 'main' | 'mode-switcher';
  type?: 'separator';
}

/**
 * 标题栏按钮配置
 */
export interface TitleBarButtonConfig {
  id: string;
  title?: string;
  icon: string;
  command?: string;
  onClick?: (context: any) => void;
  location?: 'left' | 'right';
}

/**
 * 插件上下文接口
 */
export interface PluginContext {
  // 语法扩展
  registerSyntaxExtension(ext: MarkedExtension): void;
  
  // 生命周期钩子
  on(hook: string, callback: Function): void;
  
  // 依赖注入
  provide(key: string | symbol, service: any): void;
  inject(key: string | symbol): any;
  
  // 事件总线
  emit(eventName: string, payload: any): void;
  listen(eventName: string, callback: Function): void;
  
  // 持久化存储
  getScopedStore(): ScopedPersistenceStore;
  
  // VFS 集成
  getVFSManager(): any | null;
  getCurrentNodeId(): string | null;
  
  // 编辑器专用（仅在 MDxEditor 中可用）
  registerCommand?(name: string, fn: Function): void;
  registerToolbarButton?(config: ToolbarButtonConfig): void;
  registerTitleBarButton?(config: TitleBarButtonConfig): void;
  renderInElement?(element: HTMLElement, markdown: string): Promise<void>;
  findAndSelectText?(text: string): void;
  switchToMode?(mode: 'edit' | 'render'): void;
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

/**
 * 持久化适配器接口
 */
export interface IPersistenceAdapter {
  get(key: string): Promise<any>;
  set(key: string, value: any): Promise<void>;
  remove(key: string): Promise<void>;
}
