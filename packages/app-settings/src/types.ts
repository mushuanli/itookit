// @file app-settings/types.ts

// 从 common 导入类型
import type { 
    LLMConnection as CommonLLMConnection,
    AgentStorageConfig, // ✨ 从 common 导入
    MCPServer
} from '@itookit/llmdriver';

// 重新导出 LLMConnection，保持向后兼容
export type LLMConnection = CommonLLMConnection;

// ✨ 使用 Common 定义的 Agent 结构，不再本地定义
// AgentFileContent 对应整个 .agent 文件的 JSON 结构
// AgentConfig 对应文件中的 config 字段
export type AgentConfig = AgentStorageConfig;


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
