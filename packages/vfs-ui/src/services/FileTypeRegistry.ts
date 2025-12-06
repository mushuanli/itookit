/**
 * @file vfs-ui/services/FileTypeRegistry.ts
 * @description Centralized registry for file type mappings (icons, editors).
 */
import type { FileTypeDefinition, CustomEditorResolver, IFileTypeRegistry, ContentParser } from './IFileTypeRegistry';
import type { EditorFactory } from '@itookit/common';
import type { VFSNodeUI } from '../types/types';

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
    public register(def: FileTypeDefinition): void {
        const normalizedDef = { ...def };
        
        // 建立扩展名索引 (统一小写)
        def.extensions.forEach(ext => {
            const key = ext.toLowerCase();
            this.extensionMap.set(key, normalizedDef);
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
    public getIcon(filename: string, isDirectory: boolean = false): string {
        if (isDirectory) return DEFAULT_ICON_MAP['folder'];

        const ext = this._getExtension(filename);
        
        // 1. 检查用户注册表
        const def = this.extensionMap.get(ext);
        if (def && def.icon) {
            return def.icon;
        }

        // 2. 检查内置映射表
        if (DEFAULT_ICON_MAP[ext]) {
            return DEFAULT_ICON_MAP[ext];
        }

        // 3. 最终兜底
        return DEFAULT_ICON_MAP['default'];
    }

    /**
     * 解析编辑器 Factory
     * 逻辑: 
     * 1. 用户自定义 CustomResolver (createIEditor)
     * 2. 注册表匹配扩展名
     * 3. 默认 EditorFactory
     */
    public resolveEditorFactory(node: VFSNodeUI): EditorFactory {
        // 1. Check Custom Resolver
        if (this.customResolver) {
            const factory = this.customResolver(node);
            if (factory) return factory;
        }

        // 2. Check Extension Registry
        // 优先尝试从 custom metadata 中获取原始扩展名
        let ext = '';
        if (node.metadata.custom && typeof node.metadata.custom._extension === 'string') {
            ext = node.metadata.custom._extension.toLowerCase();
        } else {
            ext = this._getExtension(node.metadata.path || node.metadata.title || '');
        }

        const def = this.extensionMap.get(ext);
        if (def && def.editorFactory) {
            return def.editorFactory;
        }

        // 3. Fallback to Default
        return this.defaultFactory;
    }

    /**
     * [新增] 解析内容解析器
     */
    public resolveContentParser(filename: string): ContentParser | undefined {
        const ext = this._getExtension(filename);
        const def = this.extensionMap.get(ext);
        return def?.contentParser;
    }

    private _getExtension(filename: string): string {
        const lastDot = filename.lastIndexOf('.');
        // 忽略隐藏文件 (.config) 或无后缀文件
        if (lastDot > 0) {
            return filename.substring(lastDot).toLowerCase();
        }
        return '';
    }
}
