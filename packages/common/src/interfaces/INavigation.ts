// @file common/interfaces/INavigation.ts

export interface NavigationRequest {
    /**
     * 目标模块 ID (对应 WORKSPACES 配置中的 elementId 或 moduleName)
     * 例如: 'settings', 'agents', 'chat', 'prompts'
     * 特殊值: 'self' 表示当前模块
     */
    target: string;

    /**
     * 目标内的资源 ID 或路径
     * 例如: 
     * - settings: 'connections'
     * - agents: 'agent-123'
     * - chat: 'session-abc'
     */
    resourceId?: string;

    /**
     * 附加动作或参数
     * 例如: { mode: 'edit', query: 'search term' }
     */
    params?: Record<string, any>;
}
