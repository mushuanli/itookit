// @file: llm-engine/services/agent-service.ts

import { RestorableItem } from '@itookit/common';
import { LLMConnection, AgentDefinition } from '@itookit/llm-driver';

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
    args?: string;
    cwd?: string;
    apiKey?: string;
    headers?: Record<string, string>;
    autoConnect?: boolean;
    timeout?: number;
    tools?: any[];
    resources?: any[];
    icon?: string;
    description?: string;
}

/**
 * Agent 服务 — 核心读取接口
 * SessionManager / AgentResolver 只依赖此接口
 */
export interface IAgentService {
    init(): Promise<void>;

    // 读取
    getAgentConfig(agentId: string): Promise<AgentDefinition | null>;
    getAgents(): Promise<AgentDefinition[]>;
    getConnection(connectionId: string): Promise<LLMConnection | undefined>;
    getDefaultConnection(): Promise<LLMConnection | null>;

    // 事件
    onChange(callback: () => void): () => void;
}

/**
 * Agent 管理服务 — 完整 CRUD 接口
 * 设置页面、管理 UI 依赖此接口
 */
export interface IAgentManagementService extends IAgentService {
    // Agent CRUD
    saveAgent(agent: AgentDefinition): Promise<void>;
    deleteAgent(agentId: string): Promise<void>;

    // Connection CRUD
    getConnections(): Promise<LLMConnection[]>;
    saveConnection(conn: LLMConnection): Promise<void>;
    deleteConnection(id: string): Promise<void>;

    // MCP CRUD
    getMCPServers(): Promise<MCPServer[]>;
    saveMCPServer(server: MCPServer): Promise<void>;
    deleteMCPServer(id: string): Promise<void>;

    // 恢复/诊断
    getRestorableItems(): Promise<RestorableItem[]>;
    restoreItem(type: 'connection' | 'agent', id: string): Promise<void>;
}
