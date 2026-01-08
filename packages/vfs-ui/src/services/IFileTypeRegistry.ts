/**
 * @file vfs-ui/services/IFileTypeRegistry.ts
 * @description Defines interfaces for registering file types, icons, and editors.
 */

import { EditorFactory,Heading } from '@itookit/common';
import { VFSNodeUI, FileMetadata } from '../types/types';

/**
 * 解析结果结构
 */
export interface ParseResult {
    summary: string;
    searchableText: string;
    headings: Heading[];
    metadata: FileMetadata;
}

/**
 * [新增] 内容解析器函数签名
 * @param content 文件原始内容
 * @param fileExtension 文件扩展名 (e.g., '.json', '.chat')
 */
export type ContentParser = (content: string, fileExtension: string) => Partial<ParseResult>;

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
    /** [新增] 自定义内容解析逻辑，用于生成摘要、大纲等 */
    contentParser?: ContentParser; 
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
// [新增] 解析器获取接口
export type ContentParserResolver = (filename: string) => ContentParser | undefined;

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
    /** [新增] 获取解析器 */
    resolveContentParser(filename: string): ContentParser | undefined;
}
