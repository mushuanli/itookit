// @file memory-manager/index.ts
import '@itookit/vfs-ui/style.css';
import '@itookit/mdxeditor/style.css';
import './styles/memory-manager.css';

export * from './types';
export * from './core/MemoryManager';
export * from './core/BackgroundBrain';

// 方便用户直接使用默认编辑器工厂
export { createMDxEditor } from '@itookit/mdxeditor';

// 重新导出通用类型
export type { EditorFactory, IEditor, EditorOptions } from '@itookit/common';
