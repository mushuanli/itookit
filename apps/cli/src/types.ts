export type RunStatus = 'created' | 'running' | 'waiting' | 'succeeded' | 'failed' | 'cancelled';
export type WorkspaceAccess = 'read' | 'write';

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
}

export interface TaskConfig {
    id: string;
    agent: string;
    description: string;
    depends_on?: string[];
    inputs?: Record<string, unknown>;
    outputs?: Record<string, 'text' | 'json' | 'file'>;
    workspace_access?: WorkspaceAccess;
    retry?: { max_attempts: number; backoff_ms?: number };
    timeout?: string | number;
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
