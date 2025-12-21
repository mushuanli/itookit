// @file memory-manager/index.ts
import './styles/memory-manager.css';

export * from './types';
export * from './core/MemoryManager';
export * from './core/BackgroundBrain';


// 重新导出通用类型
export type { EditorFactory, IEditor, EditorOptions } from '@itookit/common';
