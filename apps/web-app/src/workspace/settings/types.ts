// @file app/workspace/settings/types.ts

// 从 common 导入类型
import type { LLMConnection as CommonLLMConnection } from '@itookit/common';

// 重新导出，保持向后兼容
export type LLMConnection = CommonLLMConnection;

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
    modelId: string;
    systemPrompt?: string;
    maxHistoryLength?: number;
    autoPrompts?: string[];
    mcpServers?: string[];
    temperature?: number; // [新增]
}

// 这是保存在 .agent 文件中的 JSON 结构
export interface AgentFileContent {
    id: string;
    name: string;
    type: 'agent' | 'orchestrator'; // 对应 ExecutorType 'atomic' | 'composite'
    description?: string;
    icon?: string; 
    config: AgentConfig; // 存储态配置
    
    // [新增] 运行时接口定义 (Inputs/Outputs)，用于转换成 ExecutorConfig
    interface?: {
        inputs: Array<{ name: string; type: string }>;
        outputs: Array<{ name: string; type: string }>;
    };
    
}


export interface SettingsState {
    connections: LLMConnection[];
    mcpServers: MCPServer[];
    tags: Tag[];
    contacts: Contact[];
}
