/**
 * @file vfs-ui/interfaces/IVFSUIManager.ts
 */
import { VFSCore, VNode } from '@itookit/vfs-core';

/**
 * 树形节点（扩展 VNode，包含 children）
 * 这是 UI 层使用的数据结构
 */
export interface TreeNode extends VNode {
  children?: TreeNode[];
}

/**
 * VFS UI 管理器接口
 */
export interface IVFSUIManager {
  /**
   * 启动 UI 管理器
   */
  start(): Promise<void>;

  /**
   * 销毁 UI 管理器
   */
  destroy(): void;

  /**
   * 切换模块
   */
  setModule(moduleName: string): Promise<void>;

  /**
   * 获取当前模块
   */
  getCurrentModule(): string;

  /**
   * 设置活动节点
   */
  setActiveNode(nodeId: string): Promise<void>;

  /**
   * 获取活动节点
   */
  getActiveNode(): VNode | null;

  /**
   * 刷新文件树
   */
  refreshTree(): Promise<void>;

  /**
   * 注册编辑器
   */
  registerEditor(contentType: string, factory: EditorFactory): void;

  /**
   * 获取活动编辑器
   */
  getActiveEditor(): IEditor | null;

  /**
   * 事件订阅
   */
  on(event: VFSUIEvent, callback: EventCallback): UnsubscribeFn;

  /**
   * 切换侧边栏
   */
  toggleSidebar(): void;

  /**
   * 设置标题
   */
  setTitle(title: string): void;
}

/**
 * VFS UI 配置选项
 */
export interface VFSUIOptions {
  /**
   * VFS 核心实例
   */
  vfsCore: VFSCore;

  /**
   * 模块名称
   */
  module: string;

  /**
   * 侧边栏容器
   */
  container: HTMLElement;

  /**
   * 编辑器容器（可选）
   */
  editorContainer?: HTMLElement;

  /**
   * 大纲容器（可选）
   */
  outlineContainer?: HTMLElement;

  /**
   * 只读模式
   */
  readOnly?: boolean;

  /**
   * 右键菜单配置
   */
  contextMenu?: ContextMenuConfig;

  /**
   * 初始状态
   */
  initialState?: {
    expandedFolderIds?: string[];
    activeNodeId?: string;
  };
}

/**
 * 编辑器接口
 */
export interface IEditor {
  /**
   * 获取文本内容
   */
  getText(): string;

  /**
   * 设置文本内容
   */
  setContent(content: string): void;

  /**
   * 获取选中文本
   */
  getSelection(): string;

  /**
   * 插入文本
   */
  insert(text: string, position?: number): void;

  /**
   * 聚焦编辑器
   */
  focus(): void;

  /**
   * 跳转到指定行
   */
  goToLine(line: number): void;

  /**
   * 事件监听
   */
  on(event: EditorEvent, callback: (data?: any) => void): UnsubscribeFn;

  /**
   * 销毁编辑器
   */
  destroy(): void;
}

/**
 * 编辑器工厂函数
 */
export type EditorFactory = (
  container: HTMLElement,
  node: VNode,
  options?: EditorOptions
) => IEditor;

/**
 * 编辑器选项
 */
export interface EditorOptions {
  initialContent?: string;
  readOnly?: boolean;
  metadata?: ContentMetadata;
  theme?: 'light' | 'dark';
  lineNumbers?: boolean;
  lineWrapping?: boolean;
}

/**
 * 编辑器事件
 */
export type EditorEvent = 
  | 'change'
  | 'focus'
  | 'blur'
  | 'selection'
  | 'save';

/**
 * 编辑器内容
 */
export interface EditorContent {
  /**
   * 原始内容
   */
  raw: string;

  /**
   * 格式化后的内容（可选）
   */
  formatted?: any;

  /**
   * 内容元数据
   */
  metadata?: ContentMetadata;
}

/**
 * 内容元数据
 */
export interface ContentMetadata {
  /**
   * 标题列表（用于大纲）
   */
  headings?: Heading[];

  /**
   * 摘要
   */
  summary?: string;

  /**
   * 统计信息
   */
  stats?: {
    wordCount?: number;
    clozeCount?: number;
    taskCount?: number;
    linkCount?: number;
    messageCount?: number;
  };
}

/**
 * 标题
 */
export interface Heading {
  level: number;
  text: string;
  line: number;
}

/**
 * VFS UI 事件类型
 */
export type VFSUIEvent =
  | 'nodeSelected'
  | 'nodeCreated'
  | 'nodeUpdated'
  | 'nodeDeleted'
  | 'moduleChanged'
  | 'sidebarToggled'
  | 'editorChanged';

/**
 * 事件回调
 */
export type EventCallback = (data: any) => void;

/**
 * 取消订阅函数
 */
export type UnsubscribeFn = () => void;

/**
 * 过滤条件
 */
export interface FilterCriteria {
  /**
   * 搜索关键词
   */
  query?: string;

  /**
   * 内容类型
   */
  contentType?: string;

  /**
   * 标签
   */
  tags?: string[];

  /**
   * 节点类型
   */
  type?: 'file' | 'folder';
}

/**
 * 右键菜单配置
 */
export interface ContextMenuConfig {
  /**
   * 是否启用
   */
  enabled: boolean;

  /**
   * 菜单项
   */
  items?: ContextMenuItem[];
}

/**
 * 右键菜单项
 */
export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: string;
  action: (node: VNode) => void | Promise<void>;
  separator?: boolean;
  disabled?: (node: VNode) => boolean;
}

/**
 * 内容视图适配器接口
 */
export interface IContentViewAdapter {
  /**
   * 检查是否能处理此节点
   */
  canHandle(node: VNode): boolean;

  /**
   * 创建编辑器实例
   */
  createEditor(
    container: HTMLElement,
    node: VNode
  ): Promise<IEditor>;

  /**
   * 加载内容
   */
  loadContent(node: VNode): Promise<EditorContent>;

  /**
   * 保存内容
   */
  saveContent(node: VNode, content: string): Promise<void>;

  /**
   * 获取元数据
   */
  getMetadata(node: VNode): Promise<ContentMetadata>;
}
