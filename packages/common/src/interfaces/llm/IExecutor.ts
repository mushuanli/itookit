// @file: common/interfaces/llm/IExecutor.ts
// ==================== 核心统一类型定义 ====================

/**
 * 执行单元的类型
 * - 'atomic': 原子 Agent，直接执行任务
 * - 'composite': 复合单元，包含子节点（即编排器）
 */
export type ExecutorType = 'atomic' | 'composite';

/**
 * 复合单元的编排模式
 */
export type OrchestrationMode = 'serial' | 'parallel' | 'router' | 'loop' | 'dag' | 'state-machine';

/**
 * 控制指令
 */
export interface ControlDirective {
  action: 'continue' | 'end' | 'route' | 'retry' | 'pause';
  target?: string;           // 路由目标
  reason?: string;           // 原因说明
  context?: Record<string, unknown>;  // 传递的上下文
}

/**
 * 执行结果
 */
export interface ExecutionResult {
  status: 'success' | 'partial' | 'failed';
  output: unknown;
  control: ControlDirective;
  metadata?: {
    duration?: number;
    tokenUsage?: number;
    confidence?: number;
  };
}

/**
 * 统一的执行单元接口
 * Agent 和 Orchestrator 都实现此接口
 */
export interface IExecutor {
  readonly id: string;
  readonly type: ExecutorType;
  execute(input: unknown, context: ExecutionContext): Promise<ExecutionResult>;
}

// ==================== 统一配置结构 ====================

/**
 * 基础配置 - Agent 和 Orchestrator 共享
 */
export interface BaseExecutorConfig {
  id: string;
  name: string;
  description?: string;
  
  // 输入输出定义
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

// ==================== 执行上下文 ====================

export interface ExecutionContext {
  executionId: string;
  parentId?: string;
  variables: Map<string, unknown>;
  results: Map<string, ExecutionResult>;
  depth: number;  // 嵌套深度
}
