// @file: llm-engine/src/services/agent-service.ts

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
    /**
     * ✅ 新增：获取默认或回退的 Connection
     * 保证总能返回一个可用的 Connection，除非一个都没有。
     */
    getDefaultConnection(): Promise<LLMConnection | null>;
    saveConnection(conn: LLMConnection): Promise<void>;
    deleteConnection(id: string): Promise<void>;

    // MCP Servers
    getMCPServers(): Promise<MCPServer[]>;
    saveMCPServer(server: MCPServer): Promise<void>;
    deleteMCPServer(id: string): Promise<void>;

    getRestorableItems(): Promise<RestorableItem[]>;
    restoreItem(type: 'connection' | 'agent', id: string): Promise<void>;

    // Events
    onChange(callback: () => void): () => void;
}
