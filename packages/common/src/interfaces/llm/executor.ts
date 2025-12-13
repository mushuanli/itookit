// @file: common/interfaces/llm/executor.ts

/**
 * ========================================================
 * 核心定义
 * ========================================================
 */

/**
 * 执行单元类型
 * - 'atomic': 原子节点 (Agent/Tool)
 * - 'composite': 复合节点 (Orchestrator)
 */
export type ExecutorType = 'atomic' | 'composite';

/**
 * 编排模式 (用于 Composite 节点)
 */
export type OrchestrationMode = 'serial' | 'parallel' | 'router' | 'loop' | 'dag' | 'state-machine';

/**
 * 节点/步骤状态
 * Agent Runtime 使用 StepStatus，UI/Engine 使用 NodeStatus，两者保持一致
 */
export type StepStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled' | 'waiting_user';

/**
 * ✨ [新增] NodeStatus
 * UI 层和持久化层常用的状态定义，与 StepStatus 兼容
 */
export type NodeStatus = StepStatus;

/**
 * 控制指令
 * 用于告诉运行时下一步该做什么
 */
export interface ControlDirective {
  action: 'continue' | 'break' | 'delegate' | 'end' | 'route' | 'retry' | 'pause';
  target?: string;           // 路由目标 ID
  reason?: string;           // 原因说明
  context?: Record<string, unknown>;  // 传递给下一步的上下文
}

/**
 * 执行结果 (泛型)
 */
export interface ExecutionResult<T = unknown> {
  status: 'success' | 'failed' | 'partial';
  output: T;
  control: ControlDirective;
  metadata?: {
    duration?: number;
    tokenUsage?: number;
    confidence?: number;
    /** 
     * [FIX] 显式定义思考长度，保证类型安全。
     * 如果 UI 依赖它，它就应该在接口里。
     */
    thinkingLength?: number; 
  };
}

/**
 * ========================================================
 * 配置结构 (持久化/定义层)
 * ========================================================
 */

/**
 * 基础配置 - Agent 和 Orchestrator 共享
 */
export interface BaseExecutorConfig {
  id: string;
  name: string;
  description?: string;
  
  // 输入输出 Schema 定义
  input?: {
    schema?: Record<string, unknown>;  // JSON Schema
    required?: string[];
  };
  output?: {
    schema?: Record<string, unknown>;
  };
  
  // 执行约束
  constraints?: {
    maxTokens?: number;
    timeout?: number;
    maxRetries?: number;
  };
  
  // 元数据
  metadata?: Record<string, unknown>;
}

/**
 * 原子 Agent 特有配置
 */
export interface AtomicConfig {
  // LLM 配置
  llm: {
    model: string;
    temperature?: number;
    systemPrompt: string;
  };
  
  // 可用工具
  tools?: string[];
  
  // 能力声明
  capabilities?: {
    canDelegate?: boolean;
    canRequestInput?: boolean;
  };
}

/**
 * 复合单元（编排器）特有配置
 */
export interface CompositeConfig {
  // 编排模式
  mode: OrchestrationMode;
  
  // 子节点（可以是 Agent 或嵌套的 Orchestrator）
  children: ExecutorConfig[];
  
  // 模式特定配置
  modeConfig?: {
    // Router 模式
    router?: {
      strategy: 'llm' | 'rule' | 'adaptive';
      rules?: Array<{ condition: string; target: string }>;
    };
    // Loop 模式
    loop?: {
      maxIterations: number;
      exitCondition?: string;
    };
    // Parallel 模式
    parallel?: {
      maxConcurrency?: number;
      mergeStrategy?: 'wait_all' | 'first_success';
    };
    // DAG 模式
    dag?: {
      edges?: Array<{ from: string; to: string; condition?: string }>;
    };
  };
}

/**
 * 统一的执行单元配置
 * 使用判别联合类型
 */
export type ExecutorConfig = BaseExecutorConfig & (
  | { type: 'atomic'; config: AtomicConfig }
  | { type: 'composite'; config: CompositeConfig }
);

/**
 * ========================================================
 * 运行时接口
 * ========================================================
 */

/**
 * 执行上下文
 */
export interface IExecutionContext {
  readonly executionId: string;
  readonly parentId?: string; // 父节点执行 ID
  readonly depth: number;
  
  readonly signal?: AbortSignal; // 用于取消操作
  
  // 变量域
  readonly variables: ReadonlyMap<string, unknown>;
  
  // 历史结果 (用于 DAG 或后续步骤引用)
  readonly results?: ReadonlyMap<string, ExecutionResult>;
}

/**
 * 执行器接口 (Runtime)
 */
export interface IExecutor<TInput = unknown, TOutput = unknown> {
  readonly id: string;
  readonly name: string;
  readonly type: ExecutorType;
  
  execute(input: TInput, context: IExecutionContext): Promise<ExecutionResult<TOutput>>;
}

