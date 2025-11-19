import '@itookit/vfs-ui/style.css';
import '@itookit/mdxeditor/style.css';
import './styles/memory-manager.css';

export * from './types';
export * from './core/MemoryManager';
export * from './core/BackgroundBrain';

// 为了方便用户，可以重新导出一些常用的类型
export type { EditorFactory, IEditor, EditorOptions } from '@itookit/common';
