// @file: common/interfaces/llm/agent.ts
// Agent、MCP 及服务接口定义。

import type { LLMConnection, ConnectionMeta, LLMProviderDefinition, ConnectionTestResult } from './connection';
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

// ─── LLMSkill ─────────────────────────────────────────────────────────────────

/** 技能类型：builtin = 代码内置 / http = 远程 HTTP 端点 / custom = 自定义扩展 */
export type LLMSkillType = 'builtin' | 'http' | 'custom';

/**
 * 持久化 Skill 配置（存储在 __config:/llm/.skills/<id>.json）。
 * 运行时通过 /dev/llm/skills/<id> 访问。
 */
export interface LLMSkill {
    id: string;
    name: string;
    description?: string;
    type: LLMSkillType;
    enabled: boolean;
    icon?: string;

    // ── HTTP 端点配置（type = 'http'）────────────────────────────
    endpoint?: string;
    method?: 'GET' | 'POST' | 'PUT';
    headers?: Record<string, string>;

    // ── LLM function-calling 参数 Schema ─────────────────────────
    /** JSON Schema（object 类型），描述 LLM 调用此 skill 时的参数格式 */
    parameters?: Record<string, unknown>;

    metadata?: Record<string, unknown>;
    createdAt?: number;
    modifiedAt?: number;
}

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
    /** 返回所有 Provider 默认配置（含模型列表、baseURL 等） */
    getProviderDefaults(): Record<string, LLMProviderDefinition>;
    /** 测试连接参数是否可用（实际发起 HTTP 请求） */
    testConnection(params: { provider: string; apiKey: string; baseURL?: string; model?: string }): Promise<ConnectionTestResult>;
}

// ─── ILLMManagementService ───────────────────────────────────────────────────

/**
 * LLM 设备全量管理接口 — 由 LLMDeviceDriver 实现。
 *
 * 聚合连接、MCP Server、Skill 三类资源的 CRUD，
 * 是 VFSAgentService 和 Settings UI 注入的唯一管理服务契约。
 */
export interface ILLMManagementService extends IConnectionService {
    // ── MCP Server ────────────────────────────────────────────────
    getMCPServers(): Promise<MCPServer[]>;
    saveMCPServer(server: MCPServer): Promise<void>;
    deleteMCPServer(id: string): Promise<void>;

    // ── Skills ────────────────────────────────────────────────────
    getSkills(): Promise<LLMSkill[]>;
    saveSkill(skill: LLMSkill): Promise<void>;
    deleteSkill(id: string): Promise<void>;

    // ── Defaults metadata ─────────────────────────────────────────
    /** 返回当前配置数据版本号，用于增量同步默认数据 */
    getConfigVersion(): number;
    /** 返回内置的默认 Agent 定义列表 */
    getDefaultAgents(): InitialAgentDef[];
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

/**
 * 完整 Agent 管理接口（Settings UI 消费）。
 * 继承 IAgentService（读） + ILLMManagementService（连接/MCP/Skill 管理），
 * 并增加 Agent CRUD 和恢复/诊断能力。
 */
export interface IAgentManagementService extends IAgentService, ILLMManagementService {
    // Agent CRUD
    saveAgent(agent: AgentDefinition): Promise<void>;
    deleteAgent(agentId: string): Promise<void>;

    // 恢复/诊断
    getRestorableItems(): Promise<RestorableItem[]>;
    restoreItem(type: 'connection' | 'agent', id: string): Promise<void>;
}
