/**
 * @file vfs-ui/services/FileTypeRegistry.ts
 * @description Centralized registry for file type mappings (icons, editors).
 */
import type { FileTypeDefinition, CustomEditorResolver, IFileTypeRegistry, ContentParser } from './IFileTypeRegistry';
import type { EditorFactory } from '@itookit/common';
import type { VFSNodeUI } from '../types/types';
import { getExtension } from '../utils/helpers';

// 内置的默认图标映射表 (作为兜底)
const DEFAULT_ICON_MAP: Record<string, string> = {
    '.md': '📝',
    '.txt': '📄',
    '.js': '☕',
    '.ts': '📘',
    '.json': '📦',
    '.html': '🌐',
    '.css': '🎨',
    '.png': '🖼️',
    '.jpg': '🖼️',
    '.jpeg': '🖼️',
    '.gif': '🖼️',
    '.svg': '📐',
    'folder': '📁',
    'default': '📄'
};

export class FileTypeRegistry implements IFileTypeRegistry {
    private extensionMap = new Map<string, FileTypeDefinition>();
    
    private defaultFactory: EditorFactory;
    private customResolver?: CustomEditorResolver;

    constructor(
        defaultEditorFactory: EditorFactory,
        customResolver?: CustomEditorResolver
    ) {
        this.defaultFactory = defaultEditorFactory;
        this.customResolver = customResolver;
    }

    /**
     * 注册文件类型
     */
    register(def: FileTypeDefinition): void {
        def.extensions.forEach(ext => {
            this.extensionMap.set(ext.toLowerCase(), { ...def });
        });
    }

    /**
     * 获取图标
     * 逻辑优先级:
     * 1. [Mapper层处理] Node Metadata (file.icon) - 已在 NodeMapper 中处理
     * 2. [Registry] 用户注册的扩展名图标 (registerMIME)
     * 3. [Registry] 内置的详细扩展名映射 (DEFAULT_ICON_MAP)
     * 4. [Registry] 最终兜底 (DEFAULT_ICON_MAP['default'])
     */
    getIcon(filename: string, isDirectory = false): string {
        if (isDirectory) return DEFAULT_ICON_MAP['folder'];
        const ext = getExtension(filename);
        return this.extensionMap.get(ext)?.icon || DEFAULT_ICON_MAP[ext] || DEFAULT_ICON_MAP['default'];
    }

    /**
     * 解析编辑器 Factory
     * 逻辑: 
     * 1. 用户自定义 CustomResolver (createIEditor)
     * 2. 注册表匹配扩展名
     * 3. 默认 EditorFactory
     */
    resolveEditorFactory(node: VFSNodeUI): EditorFactory {
        if (this.customResolver) {
            const factory = this.customResolver(node);
            if (factory) return factory;
        }

        const ext = (node.metadata.custom?._extension as string || getExtension(node.metadata.path || node.metadata.title || '')).toLowerCase();
        return this.extensionMap.get(ext)?.editorFactory || this.defaultFactory;
    }

    /**
     * [新增] 解析内容解析器
     */
    resolveContentParser(filename: string): ContentParser | undefined {
        return this.extensionMap.get(getExtension(filename))?.contentParser;
    }
}
