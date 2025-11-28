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

// --- Agent 文件结构 ---

export interface AgentConfig {
    connectionId: string;
    modelName: string;
    systemPrompt?: string;
    maxHistoryLength?: number;
    autoPrompts?: string[];
    mcpServers?: string[];
}

// 这是保存在 .agent 文件中的 JSON 结构
export interface AgentFileContent {
    id: string;
    name: string;
    type: 'agent' | 'orchestrator';
    description?: string;
    icon?: string; // 可选，用于 UI 展示
    config: AgentConfig;
    // Tags 现在由 VFS 原生管理，文件内可以保留一份副本用于导出，但运行时以 VFS 为准
    tags?: string[]; 
}


export interface SettingsState {
    connections: LLMConnection[];
    mcpServers: MCPServer[];
    tags: Tag[];
    contacts: Contact[];
}
