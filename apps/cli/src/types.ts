export type RunStatus = 'created' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled';
export type WorkspaceAccess = 'read' | 'write';

// 图结构类型（route/spawn/supervisor/依赖引用）统一由 llm-flow 提供，保持单一来源。
import type {
    DependencyRef,
    RouteCondition,
    RouteConfig,
    RouteRule,
    SpawnConfig,
    SpawnEdge,
    SupervisorConfig,
    WorkflowTaskSpec,
} from '@itookit/llm-flow';
export type {
    DependencyRef,
    RouteCondition,
    RouteConfig,
    RouteRule,
    SpawnConfig,
    SpawnEdge,
    SupervisorConfig,
    WorkflowTaskSpec,
};

export interface WorkflowConfigV1 {
    version: 1;
    name: string;
    goal: string;
    workspace?: { root?: string; state_dir?: string };
    providers: ProviderConfig[];
    connections: ConnectionConfig[];
    agents: AgentConfig[];
    tasks: TaskConfig[];
    result: { task: string; output: string };
    runtime?: { max_concurrency?: number; max_duration?: string | number };
    sandbox?: SandboxConfig;
}

export interface ProviderConfig {
    id: string;
    name?: string;
    implementation: 'openai-compatible' | 'anthropic' | 'gemini' | 'custom';
    base_url: string;
    default_path?: string;
    api_key_env: string;
    models: Array<{
        id: string;
        name?: string;
        tier?: 'optimal' | 'standard' | 'fast';
        context_window?: number;
        max_output?: number;
        supports_tools?: boolean;
        supports_thinking?: boolean;
    }>;
}

export interface ConnectionConfig {
    id: string;
    name?: string;
    provider: string;
    tiers: Partial<Record<'optimal' | 'standard' | 'fast', string>>;
}

export interface AgentConfig {
    id: string;
    name?: string;
    connection: string;
    model_tier?: 'optimal' | 'standard' | 'fast';
    model?: string;
    system_prompt?: string;
    tools?: string[];
    max_exchanges?: number;
    temperature?: number;
    max_tokens?: number;
    thinking?: boolean;
    reasoning_effort?: 'low' | 'medium' | 'xhigh';
    stream?: boolean;
    /** 工具审批策略：none=直接执行，external=有副作用的工具需批准，all=全部批准。 */
    approval?: 'none' | 'external' | 'all';
}

/** 路由条件：字符串为相等匹配，对象支持 eq/neq/in/exists/and/or/not 组合。 */
export interface TaskConfig {
    id: string;
    /** 显式任务类型；缺省时按 route/spawn/supervisor 字段推断。 */
    kind?: 'agent' | 'route' | 'spawn' | 'supervisor';
    agent?: string;
    description?: string;
    route?: RouteConfig;
    /** 循环体节点声明的迭代上限（环上节点共享）。 */
    max_iterations?: number;
    /** 运行期动态添加节点/边。 */
    spawn?: SpawnConfig;
    /** 本任务失败时执行的补偿任务 id（Saga 回滚）。 */
    compensate?: string;
    /** Supervisor 编排：本任务作为 supervisor，反复派发 workers 直到输出最终答案。 */
    supervisor?: SupervisorConfig;
    depends_on?: DependencyRef[];
    inputs?: Record<string, unknown>;
    outputs?: Record<string, 'text' | 'json' | 'file'>;
    workspace_access?: WorkspaceAccess;
    retry?: { max_attempts: number; backoff_ms?: number };
    timeout?: string | number;
    priority?: number;
    budget?: Record<string, number>;
}

export interface SandboxConfig {
    mode?: 'native' | 'oci';
    engine?: 'auto' | 'podman' | 'docker';
    image?: string;
    network?: 'none' | 'host';
    limits?: { cpus?: number; memory?: string; pids?: number };
}

export interface WorkspaceGrant {
    id: string;
    path: string;
    access: WorkspaceAccess;
    createdAt: number;
}

export interface PendingInteraction {
    taskId: string;
    interactionId: string;
    kind: 'input' | 'approval';
    prompt: string;
    payload?: unknown;
}

export interface RunManifest {
    version: 1;
    id: string;
    name: string;
    goal: string;
    workspaceRoot: string;
    configPath: string;
    configHash: string;
    status: RunStatus;
    sessionId: string;
    rootTaskId?: string;
    nodeTaskIds: Record<string, string>;
    taskStatuses: Record<string, string>;
    taskStartedAt?: Record<string, number>;
    pendingInteractions: PendingInteraction[];
    grants: WorkspaceGrant[];
    lastEventSequence: number;
    createdAt: number;
    updatedAt: number;
    completedAt?: number;
    resultPath?: string;
    error?: string;
}

export interface CompiledWorkflow {
    config: WorkflowConfigV1;
    workspaceRoot: string;
    stateDir: string;
    maxDurationMs?: number;
}
