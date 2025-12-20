// @file memory-manager/index.ts
import './styles/memory-manager.css';

export * from './types';
export * from './core/MemoryManager';
export * from './core/BackgroundBrain';

// 方便用户直接使用默认编辑器工厂
export {createMDxEnhancer} from './enhancers/mdx';

// 重新导出通用类型
export type { EditorFactory, IEditor, EditorOptions } from '@itookit/common';
