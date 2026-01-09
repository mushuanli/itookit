/**
 * @file memory-manager/types.ts
 */
import type { VFS } from '@itookit/vfs';
import { EditorFactory, ISessionEngine, SessionUIOptions,NavigationRequest } from '@itookit/common';
import type { FileTypeDefinition, CustomEditorResolver } from '@itookit/vfs-ui';

export interface MemoryManagerConfig {
    /** 挂载容器 */
    container: HTMLElement;

    /** 
     * [关键] Scope ID 用于多实例隔离 (localStorage key, modal ID 等)
     */
    scopeId?: string;

    // --- 引擎配置 ---
    /** 
     * VFS 实例 (与 moduleName 配合使用)
     * 如果提供了 customEngine，则此项可选
     */
    vfs?: VFS;

    /** 
     * 自定义引擎实例 (推荐)。
     * 如果提供，将忽略 moduleName。
     */
    customEngine?: ISessionEngine;

    /* 创建默认engine */
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

    /**
     * [通用] 宿主导航回调
     * 当编辑器请求跳转到其他模块时触发
     */
    onNavigate?: (request: NavigationRequest) => Promise<void>;

    /**
     * [新增] 会话变更回调
     * 当模块内部激活的文件/会话发生变化时触发 (用于同步 URL)
     */
    onSessionChange?: (sessionId: string | null) => void;

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
