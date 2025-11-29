/**
 * @file common/interfaces/IFileTypeRegistry.ts
 * @description Defines interfaces for registering file types, icons, and editors.
 */

import { EditorFactory } from '@itookit/common';
import { VFSNodeUI } from '../types/types';

/**
 * 文件类型定义
 */
export interface FileTypeDefinition {
    /** 文件扩展名列表 (e.g., ['.js', '.jsx'])，必须包含点，大小写不敏感 */
    extensions: string[];
    /** MIME 类型列表 (e.g., ['text/javascript']) - 预留字段，暂未用于核心逻辑 */
    mimeTypes?: string[];
    /** 显示的图标 (Emoji 或 HTML string 或 Image URL) */
    icon?: string;
    /** 该类型对应的编辑器工厂函数 */
    editorFactory?: EditorFactory;
}

/**
 * 用户自定义的编辑器解析器 (最高优先级)
 * 对应需求中的 "User defined createIEditor interface"
 * 如果返回 null/undefined，则回退到注册表查找
 */
export type CustomEditorResolver = (node: VFSNodeUI) => EditorFactory | null | undefined;

/**
 * 图标解析器函数签名
 */
export type IconResolver = (filename: string, isDirectory: boolean) => string;

/**
 * 注册表服务接口
 */
export interface IFileTypeRegistry {
    /** 注册新的文件类型配置 */
    register(definition: FileTypeDefinition): void;
    /** 根据文件名获取图标 (Registry -> Default Fallback) */
    getIcon(filename: string, isDirectory?: boolean): string;
    /** 根据文件节点获取最匹配的 EditorFactory (Custom -> Registry -> Default Fallback) */
    resolveEditorFactory(node: VFSNodeUI): EditorFactory;
}
