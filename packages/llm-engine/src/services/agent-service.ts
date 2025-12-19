// @file: llm-engine/src/services/agent-service.ts

import { LLMConnection } from '@itookit/llm-driver';

/**
 * Agent 类型
 */
export type AgentType = 'agent' | 'composite' | 'tool' | 'workflow';

/**
 * Agent 配置
 */
export interface AgentConfig {
    connectionId: string;
    modelId: string;
    systemPrompt?: string;
    maxHistoryLength?: number;
    temperature?: number;
    // optional
    mcpServers?: string[];
}

/**
 * 运行时接口定义 (Inputs/Outputs)
 * 用于 UI 生成表单、校验输入或在编排器中连线
 */
export interface AgentInterfaceDef {
    inputs: Array<{ name: string; type: string }>;
    outputs: Array<{ name: string; type: string }>;
}

/**
 * Agent 定义
 */
export interface AgentDefinition {
    id: string;
    name: string;
    type: AgentType;
    description?: string;
    icon?: string;
    config: AgentConfig;
    tags?: string[];

    /** 输入输出接口定义 */
    interface?: AgentInterfaceDef;
    
    /** VFS 元数据 (可选，通常由文件系统管理，但导出时可能包含) */
    createdAt?: number;
    modifiedAt?: number;
}

/**
 * MCP 服务器
 */
export interface MCPServer {
    id: string;
    name: string;
    transport: 'stdio' | 'http' | 'sse';
    command?: string;
    endpoint?: string;
    status?: 'idle' | 'connected' | 'error';
// API:
    args?: string;
    cwd?: string;
    apiKey?: string;
    headers?: Record<string, string>;
    autoConnect?: boolean;
    timeout?: number;
    tools?: any[];
    resources?: any[];

// UI:
    icon?: string;
    description?: string;
}

/**
 * Agent 服务接口
 */
export interface IAgentService {
    init(): Promise<void>;
    
    // Agents
    getAgents(): Promise<AgentDefinition[]>;
    getAgentConfig(agentId: string): Promise<AgentDefinition | null>;
    saveAgent(agent: AgentDefinition): Promise<void>;
    deleteAgent(agentId: string): Promise<void>;
    
    // Connections
    getConnections(): Promise<LLMConnection[]>;
    getConnection(connectionId: string): Promise<LLMConnection | undefined>;
    saveConnection(conn: LLMConnection): Promise<void>;
    deleteConnection(id: string): Promise<void>;
    
    // MCP Servers
    getMCPServers(): Promise<MCPServer[]>;
    saveMCPServer(server: MCPServer): Promise<void>;
    deleteMCPServer(id: string): Promise<void>;
    
    // Events
    onChange(callback: () => void): () => void;
}
