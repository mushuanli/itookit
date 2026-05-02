// @file: common/interfaces/llm/agent.ts
// Agent、MCP 及服务接口定义。

import type { LLMConnection, ConnectionMeta, LLMProvider, DefaultConnectionDef, ConnectionTestResult, ModelTier } from './connection';
import type { RestorableItem } from '../../types/types';

// ─── Agent ────────────────────────────────────────────────────────────────────

export type AgentType = 'agent' | 'composite' | 'tool' | 'workflow';

export interface AgentConfig {
    connectionId: string;
    /**
     * 模型层级偏好。决定从连接的 `tiers` 中取哪个模型。
     * 未设置时默认使用 'optimal'（即连接的 `model` 字段）。
     */
    modelTier?: ModelTier;
    /**
     * 精确固定某一 model ID（高级用途）。
     * 优先级高于 modelTier；设置后 tier 系统对该 agent 无效。
     * @deprecated 优先使用 modelTier + connection.tiers 配置。
     */
    modelName?: string;
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

/**
 * Skill 类型：
 * - builtin: 代码内置工具（已在 device-tools 注册，skill 只是引用）
 * - http:    远程 REST 端点，包装为 function-calling 工具
 * - shell:   本地 Shell 命令，包装为 function-calling 工具
 * - prompt:  纯 Markdown 指令注入，不产生可调用工具
 * - custom:  预留扩展
 */
export type LLMSkillType = 'builtin' | 'http' | 'shell' | 'prompt' | 'mcp' | 'custom';

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

    // ── Shell 命令配置（type = 'shell'）──────────────────────────
    /**
     * Shell 命令模板。支持 {{argName}} 占位符。
     * 例：`git log --oneline -{{n}}` → LLM 传 { n: 10 } → `git log --oneline -10`
     */
    command?: string;

    // ── Prompt 指令配置（type = 'prompt'）────────────────────────
    /**
     * Markdown 格式的指令文本，注入到 LLM 的 system prompt。
     * 不产生可调用工具，只为 LLM 提供上下文和行为规范。
     */
    instructions?: string;

    // ── LLM function-calling 参数 Schema（http / shell 类型）─────
    /** JSON Schema（object 类型），描述 LLM 调用此 skill 时的参数格式 */
    parameters?: Record<string, unknown>;

    // ── MCP 工具引用（type = 'mcp'）──────────────────────────────
    /**
     * 引用已配置的 MCP Server ID。
     * 端点、认证、协议全部继承自 MCPServer 配置，无需重复填写。
     */
    mcpServerId?: string;
    /** 该 MCP Server 上的具体工具名称 */
    mcpToolName?: string;

    metadata?: Record<string, unknown>;
    createdAt?: number;
    modifiedAt?: number;

    // ── 触发行为配置（v3.2 新增）──────────────────────────────────
    /** 触发策略：reference（自动按需）| action（仅手动 slash 命令） */
    triggerStrategy?: 'reference' | 'action';
    /** 是否随会话自动加载（triggerStrategy=reference 时通常设为 true） */
    autoLoad?: boolean;
    /** 加载优先级（越小越优先），默认 50 */
    priority?: number;
    /** Glob 模式列表，匹配文件打开时自动挂载（L4 空间联动） */
    globs?: string[];
    /** 修正日志文件路径（相对项目根，如 docs/agent-corrections.md） */
    correctionLog?: string;
    /** 禁止模型通过 load_skill 加载（action skill 专用） */
    disableModelInvocation?: boolean;
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
    /** 返回所有内置 Provider 目录（含模型列表、baseURL 等） */
    getProviderDefaults(): Record<string, LLMProvider>;
    /** 获取单个 Provider 定义 */
    getProvider(providerId: string): LLMProvider | undefined;
    /** 列出所有 Provider（不含 apiKey，供 UI 列表使用） */
    getProviders(): LLMProvider[];
    /** 返回含 apiKey 的完整 Provider（仅供 Settings UI 编辑表单使用） */
    getFullProvider(id: string): LLMProvider | undefined;
    /** 保存 Provider 到 VFS（新建或更新，含 apiKey） */
    saveProvider(provider: LLMProvider): Promise<void>;
    /** 删除用户自定义 Provider（内置 Provider 不可删除） */
    deleteProvider(id: string): Promise<void>;
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
    /** 返回内置的默认 Connection 定义列表（含多连接/同 Provider 场景） */
    getDefaultConnections(): DefaultConnectionDef[];
}

// ─── IAgentConfigService ────────────────────────────────────────────────────────────

/**
 * Agent 核心读取接口（SessionManager / AgentResolver 依赖）。
 * getConnection / getDefaultConnection 返回 ConnectionMeta（不含 apiKey），
 * 实现内部委托给 LLMDeviceDriver ioctl。
 */
export interface IAgentConfigService {
    init(): Promise<void>;
    getAgentConfig(agentId: string): Promise<AgentDefinition | null>;
    getAgents(): Promise<AgentDefinition[]>;
    /** 返回所有连接的安全元数据列表（不含 apiKey） */
    getConnections(): Promise<ConnectionMeta[]>;
    /** 返回安全元数据，不含 apiKey */
    getConnection(id: string): Promise<ConnectionMeta | undefined>;
    /** 返回安全元数据，不含 apiKey */
    getDefaultConnection(): Promise<ConnectionMeta | null>;
    /** 列出所有 Provider（不含 apiKey） */
    getProviders(): LLMProvider[];
    /** 返回含 apiKey 的完整 Provider（仅供 Settings UI 使用） */
    getFullProvider(id: string): LLMProvider | undefined;
    /** 获取单个 Provider（不含 apiKey） */
    getProvider(providerId: string): LLMProvider | undefined;
    /** 保存 Provider（含 apiKey） */
    saveProvider(provider: LLMProvider): Promise<void>;
    /** 删除用户自定义 Provider */
    deleteProvider(id: string): Promise<void>;
    /** 获取完整连接（含 dailyCosts），用于更新用量统计 */
    getFullConnection(id: string): Promise<LLMConnection | null>;
    /** 保存完整连接（含 dailyCosts 更新） */
    saveConnection(conn: LLMConnection): Promise<void>;
    onChange(callback: () => void): () => void;
}

// ─── IAgentManagementService ──────────────────────────────────────────────────

/**
 * 完整 Agent 管理接口（Settings UI 消费）。
 * 继承 IAgentService（读） + ILLMManagementService（连接/MCP/Skill 管理），
 * 并增加 Agent CRUD 和恢复/诊断能力。
 */
export interface IAgentManagementService extends IAgentConfigService, ILLMManagementService {
    // Agent CRUD
    saveAgent(agent: AgentDefinition): Promise<void>;
    deleteAgent(agentId: string): Promise<void>;

    // 恢复/诊断
    getRestorableItems(): Promise<RestorableItem[]>;
    restoreItem(type: 'provider' | 'connection' | 'agent', id: string): Promise<void>;
    /** 强制将所有内置 Provider / Connection / Agent 重置为出厂默认值（保留 apiKey） */
    resetAllDefaults(): Promise<void>;
}
