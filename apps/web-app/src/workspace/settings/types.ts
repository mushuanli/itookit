// @file app/workspace/settings/types.ts

// [新增] 定义 Provider 的结构
export interface LLMProviderDef {
    name: string;
    implementation?: string;
    baseURL: string;
    models: { id: string; name: string }[];
    requiresReferer?: boolean;
}

export interface LLMConnection {
    id: string;
    name: string;
    provider: string; // 'openai', 'anthropic', etc.
    model: string;
    apiKey?: string;
    baseURL?: string;
    availableModels?: { id: string; name: string }[];
}

export interface MCPServer {
    id: string;
    name: string;
    icon?: string;
    description?: string;
    transport: 'stdio' | 'http' | 'sse';
    command?: string;
    args?: string;
    cwd?: string;
    endpoint?: string;
    apiKey?: string;
    headers?: Record<string, string>;
    autoConnect?: boolean;
    timeout?: number;
    status?: 'idle' | 'connected' | 'error';
    tools?: any[];
    resources?: any[];
}

export interface AgentConfig {
    connectionId: string;
    modelName: string;
    systemPrompt?: string;
    maxHistoryLength?: number;
    autoPrompts?: string[];
    mcpServers?: string[];
}

// [修改] Executable 增加层级和元数据支持
export interface Executable {
    id: string;
    parentId?: string | null; // [新增] 支持层级
    name: string;
    type: 'agent' | 'orchestrator';
    icon?: string;
    description?: string;
    config?: AgentConfig;
    mode?: 'serial' | 'parallel';
    children?: string[]; // Orchestrator 的子节点（逻辑引用）
    
    tags?: string[]; // [新增] 支持标签
    createdAt?: number; // [新增] 创建时间
    modifiedAt?: number; // [新增] 修改时间
}

// [新增] 专门用于 Agent 管理界面的文件夹结构
export interface AgentFolder {
    id: string;
    parentId: string | null;
    name: string;
    createdAt: number;
}

export interface Tag {
    id: string;
    name: string;
    color: string;
    description?: string;
    count?: number;
}

export interface Contact {
    id: string;
    name: string;
    email?: string;
    phone?: string;
    company?: string;
    group?: string;
    notes?: string;
}

export interface SettingsState {
    connections: LLMConnection[];
    mcpServers: MCPServer[];
    executables: Executable[];
    agentFolders: AgentFolder[]; // [新增] 存储文件夹结构
    tags: Tag[];
    contacts: Contact[];
}
