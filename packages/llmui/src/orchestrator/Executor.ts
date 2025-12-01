// @file: llmui/orchestrator/Executor.ts
// ==================== 统一执行引擎 ====================
import {
  IExecutor,
  ExecutorType,
  ExecutorConfig,
  ExecutionContext,
  ExecutionResult,
  AtomicConfig,
  CompositeConfig,
  BaseExecutorConfig
} from '@itookit/common';

export class UnifiedExecutor implements IExecutor {
  readonly id: string;
  readonly type: ExecutorType;
  private config: ExecutorConfig;
  
  constructor(config: ExecutorConfig) {
    this.id = config.id;
    this.type = config.type;
    this.config = config;
  }
  
  async execute(input: unknown, context: ExecutionContext): Promise<ExecutionResult> {
    if (this.type === 'atomic') {
      return this.executeAtomic(input, context);
    } else {
      return this.executeComposite(input, context);
    }
  }
  
  private async executeAtomic(input: unknown, context: ExecutionContext): Promise<ExecutionResult> {
    // 原子 Agent 执行逻辑
    // 注意：这里需要根据 Discriminant Union 类型进行断言或收窄
    const atomicConfig = (this.config as Extract<ExecutorConfig, { type: 'atomic' }>).config;
    // ... 调用 LLM，处理工具调用等
    throw new Error('Implementation needed');
  }
  
  private async executeComposite(input: unknown, context: ExecutionContext): Promise<ExecutionResult> {
    // 复合单元执行逻辑 - 根据 mode 分发
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
        // @ts-ignore: 处理可能未知的模式
        throw new Error(`Unknown mode: ${compositeConfig.mode}`);
    }
  }
  
  private async executeSerial(
    input: unknown, 
    context: ExecutionContext, 
    config: CompositeConfig
  ): Promise<ExecutionResult> {
    let currentInput = input;
    let lastResult: ExecutionResult | null = null;
    
    for (const childConfig of config.children) {
      const child = new UnifiedExecutor(childConfig);
      lastResult = await child.execute(currentInput, {
        ...context,
        parentId: this.id,
        depth: context.depth + 1
      });
      
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
    context: ExecutionContext, 
    config: CompositeConfig
  ): Promise<ExecutionResult> {
    const children = config.children.map(c => new UnifiedExecutor(c));
    const results = await Promise.all(
      children.map(child => child.execute(input, {
        ...context,
        parentId: this.id,
        depth: context.depth + 1
      }))
    );
    
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
