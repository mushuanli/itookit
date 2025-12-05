// @file: llm-ui/services/IAgentService.ts
import { IAgentDefinition, LLMConnection, MCPServer } from '@itookit/common';

export interface IAgentService {
    // --- Init ---
    init(): Promise<void>;

    // --- Agents ---
    getAgents(): Promise<IAgentDefinition[]>;
    getAgentConfig(agentId: string): Promise<IAgentDefinition | null>;
    saveAgent(agent: IAgentDefinition): Promise<void>; // 新增，供编辑器使用

    // --- Connections ---
    getConnections(): Promise<LLMConnection[]>;
    getConnection(connectionId: string): Promise<LLMConnection | undefined>;
    saveConnection(conn: LLMConnection): Promise<void>;
    deleteConnection(id: string): Promise<void>;

    // --- MCP Servers ---
    getMCPServers(): Promise<MCPServer[]>;
    saveMCPServer(server: MCPServer): Promise<void>;
    deleteMCPServer(id: string): Promise<void>;
    
    // --- Events ---
    onChange(callback: () => void): () => void;
}
