import { VFSCore } from '@itookit/vfs-core';
import { SessionUIOptions, EditorFactory } from '@itookit/common';

export interface MemoryManagerConfig {
    /** DOM 挂载点 */
    container: HTMLElement;
    
    /** VFS 核心实例 */
    vfsCore: VFSCore;
    
    /** VFS 模块名称 (如 'wiki', 'tasks') */
    moduleName: string;
    
    /** VFS-UI 的配置 (侧边栏标题、右键菜单等) */
    uiOptions?: Partial<SessionUIOptions>;
    
    /** 
     * 编辑器工厂函数。
     * 用户通过此函数决定使用什么编辑器，以及启用哪些插件。
     * MemoryManager 会向 options 中注入 toggleSidebarCallback 等上下文回调。
     */
    editorFactory: EditorFactory;
    
    /** AI 后台处理配置 */
    aiConfig?: {
        /** 是否启用后台分析 */
        enabled: boolean;
        /** 
         * 要激活的处理规则。
         * 例如: ['user', 'task', 'tag']
         * 默认启用所有规则 ('*')
         */
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