// @file: llmui/orchestrator/Executor.ts
// ==================== 统一执行引擎 ====================
import {
  IExecutor,
  ExecutorType,
  ExecutorConfig,
  ExecutionResult,
  AtomicConfig,
  CompositeConfig,
  BaseExecutorConfig,
  generateUUID,
  NodeStatus,
  ExecutionContext // [修复] 添加导入
} from '@itookit/common';

// [修改] 从 types 导入 StreamingContext
import { StreamingContext } from '../types';

export class UnifiedExecutor implements IExecutor {
  readonly id: string;
  readonly type: ExecutorType;
  public config: ExecutorConfig;
  
  constructor(config: ExecutorConfig) {
    this.id = config.id;
    this.type = config.type;
    this.config = config;
  }
  
  // [修复] 签名必须匹配 IExecutor (context: ExecutionContext)
  async execute(input: unknown, context: ExecutionContext): Promise<ExecutionResult> {
    // [修复] 内部断言为 StreamingContext
    const streamingContext = context as StreamingContext;

    if (this.type === 'atomic') {
      return this.executeAtomic(input, streamingContext);
    } else {
      return this.executeComposite(input, streamingContext);
    }
  }
  
  private async executeAtomic(input: unknown, context: StreamingContext): Promise<ExecutionResult> {
    // 实际项目中，这里应该调用 LLMDriver 或 AgentExecutor
    // 为了演示，我们假设这会调用外部注入的 AgentExecutor 逻辑
    // 或者抛出错误提示这是一个纯编排器实现，需要外部 AgentExecutor 配合
    
    // 如果这个 UnifiedExecutor 是为了配合 AgentExecutor 使用的，
    // 那么它通常只负责编排。
    // 如果它包含原子逻辑，应该在这里实现 LLM 调用。
    throw new Error('Atomic executor logic not implemented in UnifiedExecutor. Use AgentExecutor for direct LLM calls.');
  }
  
  private async executeComposite(input: unknown, context: StreamingContext): Promise<ExecutionResult> {
    const compositeConfig = (this.config as Extract<ExecutorConfig, { type: 'composite' }>).config;
    
    switch (compositeConfig.mode) {
      case 'serial':
        return this.executeSerial(input, context, compositeConfig);
      case 'parallel':
        return this.executeParallel(input, context, compositeConfig);
      case 'router':
        return this.executeRouter(input, context, compositeConfig);
      case 'loop':
        return this.executeLoop(input, context, compositeConfig);
      default:
        throw new Error(`Unknown mode: ${(compositeConfig as any).mode}`);
    }
  }
  
  private async executeSerial(
    input: unknown, 
    context: StreamingContext, 
    config: CompositeConfig
  ): Promise<ExecutionResult> {
    let currentInput = input;
    let lastResult: ExecutionResult | null = null;
    
    // 通知 UI 当前容器是串行布局（默认）
    if (context.parentId) {
        context.callbacks?.onNodeMetaUpdate?.(context.parentId, { layout: 'serial' });
    }
    
    for (const childConfig of config.children) {
      const child = new UnifiedExecutor(childConfig);
      const childRuntimeId = generateUUID();

      // 1. 创建子节点 UI
      context.callbacks?.onNodeStart?.({
        id: childRuntimeId,
        parentId: context.parentId, // 挂载到当前编排器节点下
        type: child.type === 'atomic' ? 'agent' : 'router',
        name: child.config.name,
        status: 'running',
        startTime: Date.now(),
        icon: (child.config as any).icon,
        data: { output: '', metaInfo: {} },
        children: []
      });

      // 2. 准备上下文 [关键修复：提取变量并指定类型，避免对象字面量检查报错]
      const childContext: StreamingContext = {
        ...context,
        parentId: childRuntimeId,
        depth: context.depth + 1,
        callbacks: {
            ...context.callbacks,
            // [关键修复：显式添加参数类型]
            onThinking: (delta: string, nodeId?: string) => 
                context.callbacks?.onThinking?.(delta, nodeId || childRuntimeId),
            
            onOutput: (delta: string, nodeId?: string) => 
                context.callbacks?.onOutput?.(delta, nodeId || childRuntimeId),
            
            onNodeStatus: (nodeId: string, status: NodeStatus) => 
                context.callbacks?.onNodeStatus?.(nodeId || childRuntimeId, status),
            
            onNodeMetaUpdate: (nodeId: string, meta: any) => 
                context.callbacks?.onNodeMetaUpdate?.(nodeId || childRuntimeId, meta)
        }
      };

      // 3. 执行子节点
      lastResult = await child.execute(currentInput, childContext);
      
      // 更新完成状态
      context.callbacks?.onNodeStatus?.(childRuntimeId, lastResult.status as any);

      if (lastResult.control.action === 'end') {
        break;
      }
      
      currentInput = lastResult.output;
    }
    
    // 如果 children 为空，需要处理 lastResult 为 null 的情况
    if (!lastResult) {
         return {
            status: 'success',
            output: currentInput,
            control: { action: 'continue' }
         };
    }

    return lastResult;
  }
  
  private async executeParallel(
    input: unknown, 
    context: StreamingContext, 
    config: CompositeConfig
  ): Promise<ExecutionResult> {
    
    // 1. 设置当前父节点为并行布局
    if (context.parentId) {
        context.callbacks?.onNodeMetaUpdate?.(context.parentId, { layout: 'parallel' });
    }

    // 2. 预生成所有子节点的 Runtime ID 和 Executor
    const childrenWorkItems = config.children.map(childConfig => ({
        executor: new UnifiedExecutor(childConfig),
        runtimeId: generateUUID()
    }));

    // 3. 批量通知 UI 创建子节点占位符
    childrenWorkItems.forEach(({ executor, runtimeId }) => {
        context.callbacks?.onNodeStart?.({
            id: runtimeId,
            parentId: context.parentId, // 挂载到当前节点下
            name: executor.config.name,
            type: executor.type === 'atomic' ? 'agent' : 'router',
            status: 'running',
            startTime: Date.now(),
            icon: (executor.config as any).icon,
            data: { 
                output: '',
                metaInfo: {
                    // 如果子节点也是编排器，可以预设它的布局信息
                    layout: (executor.config as any).config?.mode === 'parallel' ? 'parallel' : 'serial'
                }
            },
            children: []
        });
    });

    // 4. 并发执行
    const promises = childrenWorkItems.map(async ({ executor, runtimeId }) => {
        // 创建上下文切片，将输出路由到对应的 runtimeId
        const childContext: StreamingContext = {
            ...context,
            parentId: runtimeId,
            depth: context.depth + 1,
            callbacks: {
                ...context.callbacks,
                // [关键修复：显式参数类型]
                onThinking: (delta: string, nodeId?: string) => 
                    context.callbacks?.onThinking?.(delta, nodeId || runtimeId),
                
                onOutput: (delta: string, nodeId?: string) => 
                    context.callbacks?.onOutput?.(delta, nodeId || runtimeId),
                
                onNodeStatus: (nodeId: string, status: NodeStatus) => 
                    context.callbacks?.onNodeStatus?.(nodeId || runtimeId, status),
                
                onNodeMetaUpdate: (nodeId: string, meta: any) => 
                    context.callbacks?.onNodeMetaUpdate?.(nodeId || runtimeId, meta)
            }
        };

        try {
            const result = await executor.execute(input, childContext);
            context.callbacks?.onNodeStatus?.(runtimeId, result.status as any);
            return result;
        } catch (e: any) {
            context.callbacks?.onNodeStatus?.(runtimeId, 'failed');
            context.callbacks?.onOutput?.(`\nError: ${e.message}`, runtimeId);
            return {
                status: 'failed',
                output: null,
                control: { action: 'continue' } 
            } as ExecutionResult;
        }
    });

    const results = await Promise.all(promises);
    
    return {
      status: results.every(r => r.status === 'success') ? 'success' : 'partial',
      output: results.map(r => r.output),
      control: { action: 'end' }
    };
  }
  
  private async executeRouter(
    input: unknown, 
    context: ExecutionContext, 
    config: CompositeConfig
  ): Promise<ExecutionResult> {
    // 路由逻辑
    throw new Error('Implementation needed');
  }
  
  private async executeLoop(
    input: unknown, 
    context: ExecutionContext, 
    config: CompositeConfig
  ): Promise<ExecutionResult> {
    // 循环逻辑
    throw new Error('Implementation needed');
  }
}

// ==================== 工厂函数 - 简洁的创建接口 ====================

/**
 * 创建原子 Agent
 */
export function createAgent(config: BaseExecutorConfig & { config: AtomicConfig }): ExecutorConfig {
  return { ...config, type: 'atomic' };
}

/**
 * 创建编排器
 */
export function createOrchestrator(
  config: BaseExecutorConfig & { config: Omit<CompositeConfig, 'children'> },
  children: ExecutorConfig[]
): ExecutorConfig {
  return {
    ...config,
    type: 'composite',
    config: { ...config.config, children }
  };
}

/**
 * 便捷方法：串行组合
 */
export function serial(id: string, children: ExecutorConfig[]): ExecutorConfig {
  return createOrchestrator(
    { id, name: id, config: { mode: 'serial' } },
    children
  );
}

/**
 * 便捷方法：并行组合
 */
export function parallel(id: string, children: ExecutorConfig[]): ExecutorConfig {
  return createOrchestrator(
    { id, name: id, config: { mode: 'parallel' } },
    children
  );
}

/**
 * 便捷方法：路由
 */
export function router(
  id: string, 
  children: ExecutorConfig[], 
  strategy: 'llm' | 'rule' = 'llm'
): ExecutorConfig {
  return createOrchestrator(
    { id, name: id, config: { mode: 'router', modeConfig: { router: { strategy } } } },
    children
  );
}
