/**
 * @file memory-manager/types.ts
 */
import { EditorFactory, SessionUIOptions, ISessionEngine } from '@itookit/common';
import { VFSCore } from '@itookit/vfs-core';
import type { FileTypeDefinition, CustomEditorResolver } from '@itookit/vfs-ui';

export interface MemoryManagerConfig {
    /** 挂载容器 */
    container: HTMLElement;

    // --- 引擎配置 (二选一) ---
    /** 
     * 自定义引擎实例 (推荐)。
     * 如果提供，将忽略 vfsCore 和 moduleName。
     */
    customEngine?: ISessionEngine;
    
    /** 传统方式: 基于 VFSCore 的配置 */
    vfsCore?: VFSCore;
    moduleName?: string;

    // --- 编辑器配置 ---
    /** 
     * 编辑器工厂函数。
     * @default createMDxEditor (内置的 MDxEditor)
     */
    editorFactory?: EditorFactory;

    /**
     * 传递给 EditorFactory 的静态配置。
     * 包含插件列表、默认插件选项等。
     */
    editorConfig?: {
        plugins?: any[];
        defaultPluginOptions?: Record<string, any>;
        [key: string]: any;
    };

    // --- VFS UI 配置 ---
    /** 
     * 透传给 VFSUIManager 的 UI 选项 
     */
    uiOptions?: Partial<SessionUIOptions>;

    /**
     * [透传] 注册自定义文件类型、图标和对应的编辑器
     */
    fileTypes?: FileTypeDefinition[];

    /**
     * [透传] 自定义编辑器解析逻辑 (用于多编辑器共存)
     */
    customEditorResolver?: CustomEditorResolver;

    // --- 业务功能配置 ---
    /**
     * 默认文件内容配置 (当列表为空时自动创建)
     */
    defaultContentConfig?: {
        fileName: string;
        content: string;
    };

    /**
     * 后台 AI 处理器配置
     */
    aiConfig?: {
        enabled: boolean;
        activeRules?: string[];
    };
}

/**
 * 注入给编辑器的上下文能力接口。
 * 这些能力通常会被混入 EditorOptions 或其插件配置中。
 */
export interface EditorHostContext {
    /** 切换侧边栏可见性 */
    toggleSidebar: () => void;
    /** 手动触发保存 */
    saveContent: () => Promise<void>;
}