// @file: common/interfaces/llm/agent.ts
// Agent、MCP 及服务接口定义。

import type { LLMConnection, ConnectionMeta } from './connection';
import type { RestorableItem } from '../../types/types';

// ─── Agent ────────────────────────────────────────────────────────────────────

export type AgentType = 'agent' | 'composite' | 'tool' | 'workflow';

export interface AgentConfig {
    connectionId: string;
    modelName: string;
    systemPrompt?: string;
    maxHistoryLength?: number;
    temperature?: number;
    mcpServers?: string[];
}

export interface AgentInterfaceDef {
    inputs: Array<{ name: string; type: string }>;
    outputs: Array<{ name: string; type: string }>;
}

export interface AgentDefinition {
    id: string;
    name: string;
    type: AgentType;
    icon?: string;
    description?: string;
    config: AgentConfig;
    tags?: string[];
    interface?: AgentInterfaceDef;
    createdAt?: number;
    modifiedAt?: number;
}

/** 仅用于默认 agent 初始化，不持久化 initPath/initialTags */
export type InitialAgentDef = AgentDefinition & {
    initPath?: string;
    initialTags?: string[];
};

// ─── MCP ──────────────────────────────────────────────────────────────────────

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
    tools?: unknown[];
    resources?: unknown[];
    icon?: string;
    description?: string;
}

// ─── IConnectionService ───────────────────────────────────────────────────────

/**
 * 连接配置服务接口 — 由 LLMDeviceDriver 实现。
 *
 * 读取方法返回 ConnectionMeta（不含 apiKey），保持隐私边界；
 * 仅 getFullConnection() 返回完整连接，供 Settings UI 编辑使用。
 */
export interface IConnectionService {
    /** 返回安全元数据列表（不含 apiKey） */
    getConnections(): Promise<ConnectionMeta[]>;
    /** 按 ID 返回安全元数据 */
    getConnection(id: string): Promise<ConnectionMeta | undefined>;
    /** 返回默认连接的安全元数据 */
    getDefaultConnection(): Promise<ConnectionMeta | null>;
    /** 返回完整连接（含 apiKey），仅供 Settings UI 编辑表单使用 */
    getFullConnection(id: string): Promise<LLMConnection | null>;
    /** 保存连接（接受完整连接，含 apiKey） */
    saveConnection(conn: LLMConnection): Promise<void>;
    /** 删除连接 */
    deleteConnection(id: string): Promise<void>;
    /** 监听连接数据变化 */
    onChange(listener: () => void): () => void;
}

// ─── IAgentService ────────────────────────────────────────────────────────────

/**
 * Agent 核心读取接口（SessionManager / AgentResolver 依赖）。
 * getConnection / getDefaultConnection 返回 ConnectionMeta（不含 apiKey），
 * 实现内部委托给 LLMDeviceDriver ioctl。
 */
export interface IAgentService {
    init(): Promise<void>;
    getAgentConfig(agentId: string): Promise<AgentDefinition | null>;
    getAgents(): Promise<AgentDefinition[]>;
    /** 返回安全元数据，不含 apiKey */
    getConnection(id: string): Promise<ConnectionMeta | undefined>;
    /** 返回安全元数据，不含 apiKey */
    getDefaultConnection(): Promise<ConnectionMeta | null>;
    onChange(callback: () => void): () => void;
}

// ─── IAgentManagementService ──────────────────────────────────────────────────

export interface IAgentManagementService extends IAgentService {
    // Agent CRUD
    saveAgent(agent: AgentDefinition): Promise<void>;
    deleteAgent(agentId: string): Promise<void>;

    // Connection — 读取返回安全元数据；写入接受完整连接（含 apiKey）
    getConnections(): Promise<ConnectionMeta[]>;
    saveConnection(conn: LLMConnection): Promise<void>;
    deleteConnection(id: string): Promise<void>;

    // MCP
    getMCPServers(): Promise<MCPServer[]>;
    saveMCPServer(server: MCPServer): Promise<void>;
    deleteMCPServer(id: string): Promise<void>;

    // 恢复/诊断
    getRestorableItems(): Promise<RestorableItem[]>;
    restoreItem(type: 'connection' | 'agent', id: string): Promise<void>;
}
