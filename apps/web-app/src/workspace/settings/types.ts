// @file app/workspace/settings/types.ts

// 从 common 导入类型
import type { 
    LLMConnection as CommonLLMConnection,
    IAgentDefinition,    // ✨ 从 common 导入
    AgentStorageConfig   // ✨ 从 common 导入
} from '@itookit/common';

// 重新导出 LLMConnection，保持向后兼容
export type LLMConnection = CommonLLMConnection;

// ✨ 使用 Common 定义的 Agent 结构，不再本地定义
// AgentFileContent 对应整个 .agent 文件的 JSON 结构
export type AgentFileContent = IAgentDefinition;
// AgentConfig 对应文件中的 config 字段
export type AgentConfig = AgentStorageConfig;

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

export interface SettingsState {
    connections: LLMConnection[];
    mcpServers: MCPServer[];
    tags: Tag[];
    contacts: Contact[];
}
