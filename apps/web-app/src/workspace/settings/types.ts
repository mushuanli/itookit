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

export interface Executable {
    id: string;
    name: string;
    type: 'agent' | 'orchestrator';
    icon?: string;
    description?: string;
    config?: AgentConfig; // If type === agent
    mode?: 'serial' | 'parallel'; // If type === orchestrator
    children?: string[]; // If type === orchestrator
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
    tags: Tag[];
    contacts: Contact[];
}
