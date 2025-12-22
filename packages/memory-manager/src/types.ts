/**
 * @file memory-manager/types.ts
 */
import { EditorFactory, ISessionEngine, SessionUIOptions,NavigationRequest } from '@itookit/common';
import type { FileTypeDefinition, CustomEditorResolver } from '@itookit/vfs-ui';

export interface MemoryManagerConfig {
    /** 挂载容器 */
    container: HTMLElement;

    // --- 引擎配置 ---
    /** 
     * 自定义引擎实例 (推荐)。
     * 如果提供，将忽略 moduleName。
     */
    customEngine?: ISessionEngine;

    /* 创建默认engine */
    moduleName?: string;
    
    // ✅ [新增] Scope ID 用于多实例隔离 (特别是 UI 状态持久化)
    scopeId?: string;

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

    /**
     * [通用] 宿主导航回调
     */
    onNavigate?: (request: NavigationRequest) => Promise<void>;
}
