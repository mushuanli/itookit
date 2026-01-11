// @file: common/interfaces/INavigation.ts

/**
 * 统一导航请求协议
 * 
 * 设计原则：
 * 1. target 使用语义化的短名称 (slug)，而非技术实现细节 (elementId)
 * 2. resourceId 用于定位具体资源
 * 3. params 用于传递动作参数（如创建时的初始状态）
 */
export interface NavigationRequest {
    /**
     * 目标模块的语义标识 (URL slug)
     * 
     * 标准值：
     * - 'chat'      -> LLM 会话工作区
     * - 'agents'    -> Agent 配置工作区  
     * - 'settings'  -> 设置工作区
     * - 'anki'      -> Anki 卡片工作区
     * - 'prompts'   -> Prompt 库工作区
     * - 'projects'  -> 项目工作区
     * - 'emails'    -> 邮件草稿工作区
     * - 'private'   -> 私密笔记工作区
     * 
     * 特殊值：
     * - 'self'      -> 当前模块（用于模块内导航）
     */
    target: string;

    /**
     * 目标资源的唯一标识
     * 
     * 场景示例：
     * - target='chat', resourceId='session-abc'    -> 打开指定会话
     * - target='agents', resourceId='agent-123'    -> 打开指定 Agent 配置
     * - target='settings', resourceId='connections' -> 打开连接设置页
     * - target='chat', resourceId=undefined        -> 打开 Chat 工作区首页
     */
    resourceId?: string;

    /**
     * 附加参数（用于特殊动作）
     * 
     * 场景示例：
     * - { action: 'create' }                       -> 创建新资源
     * - { action: 'create', agentId: 'xxx', text: '...' } -> 创建新会话并预填内容
     * - { mode: 'edit' }                           -> 以编辑模式打开
     * - { highlight: true }                        -> 高亮显示目标
     */
    params?: {
        action?: 'create' | 'edit' | 'view';
        agentId?: string;
        text?: string;
        [key: string]: any;
    };
}
