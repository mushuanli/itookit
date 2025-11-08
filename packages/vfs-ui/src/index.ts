/**
 * @file vfs-ui/index.ts
 */
/**
 * VFS-UI - Virtual File System UI Layer
 * 
 * 为 VFS-Core 提供可视化的文件管理界面
 */

import {VFSUIOptions,IVFSUIManager} from './interfaces/IVFSUIManager';
// 核心
export { VFSUIManager } from './core/VFSUIManager';
export { EditorRegistry } from './core/EditorRegistry';
export { EventBus } from './core/EventBus';

// 组件
export { VFSTreeView } from './components/VFSTreeView';
export { VFSOutline } from './components/VFSOutline';
export { VFSToolbar } from './components/VFSToolbar';
export type { ToolbarAction } from './components/VFSToolbar';

// 适配器
export { GenericContentAdapter } from './adapters/GenericContentAdapter';
export { PlainTextAdapter } from './adapters/PlainTextAdapter';
export { MarkdownAdapter } from './adapters/MarkdownAdapter';
export { AgentAdapter } from './adapters/AgentAdapter';
export { SRSAdapter } from './adapters/SRSAdapter';

// 接口
export type {
  IVFSUIManager,
  VFSUIOptions,
  IEditor,
  EditorFactory,
  EditorOptions,
  EditorEvent,
  EditorContent,
  ContentMetadata,
  Heading,
  VFSUIEvent,
  EventCallback,
  UnsubscribeFn,
  FilterCriteria,
  ContextMenuConfig,
  ContextMenuItem,
  IContentViewAdapter
} from './interfaces/IVFSUIManager';

// 工具函数
export {
  escapeHtml,
  debounce,
  throttle,
  countWords,
  formatFileSize,
  formatRelativeTime,
  deepClone,
  getFileExtension,
  getFileIcon,
  isImageFile,
  generateId,
  parsePath,
  joinPath,
  isSubPath,
  sortNodes,
  filterNodes,
  flattenTree,
  findNode,
  extractMarkdownHeadings,
  stripMarkdown
} from './utils/helpers';

/**
 * 创建 VFS UI 管理器的便捷函数
 */
export function createVFSUI(options: VFSUIOptions): IVFSUIManager {
  return new VFSUIManager(options);
}

/**
 * 版本信息
 */
export const VERSION = '1.0.0';

/**
 * 默认导出
 */
export default {
  VFSUIManager,
  createVFSUI,
  VERSION
};
