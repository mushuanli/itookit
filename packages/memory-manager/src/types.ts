/**
 * @file memory-manager/types.ts (或者 MemoryManager 同级目录)
 */
import { EditorFactory, SessionUIOptions, ISessionEngine } from '@itookit/common';
import { VFSCore } from '@itookit/vfs-core';

export interface MemoryManagerConfig {
    container: HTMLElement;
    editorFactory: EditorFactory;
    // [修改] 变为可选，因为如果提供了 customEngine，就不需要 vfsCore
    vfsCore?: VFSCore;
    // [修改] 变为可选
    moduleName?: string;

    // [新增] 允许直接传入 ISessionEngine 实现
    customEngine?: ISessionEngine;

    // [新增] 这里的 options 会透传给 VFSUIManager
    uiOptions?: Partial<SessionUIOptions>;

    // [核心改进] 专门用于存放传递给 EditorFactory 的静态配置
    // 包含 plugins, defaultPluginOptions 等
    editorConfig?: {
        plugins?: string[];
        [key: string]: any;
    };

    aiConfig?: {
        enabled: boolean;
        activeRules?: string[];
    };
    
    // [架构修正] 将“默认文件”逻辑从 UI 层移回业务层配置
    defaultContentConfig?: {
        fileName: string;
        content: string;
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