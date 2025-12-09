// @file: llm-engine/orchestrator/execution/UnifiedExecutor.ts

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
  ExecutionContext
} from '@itookit/common';

// [修改] 从 types 导入 StreamingContext
import { StreamingContext } from '../../core/types';

// 定义工厂类型，用于解耦
export type ExecutorFactory = (config: ExecutorConfig) => IExecutor;

/**
 * 统一编排执行器
 * 职责：处理 Serial, Parallel, Router 等控制流
 * 特点：不包含任何 LLM 调用逻辑，完全依赖子节点执行
 */
export class UnifiedExecutor implements IExecutor {
  readonly id: string;
  readonly type: ExecutorType;
  public config: ExecutorConfig;
  
  constructor(
      config: ExecutorConfig,
      private childFactory?: ExecutorFactory // ✨ [关键] 注入工厂
  ) {
    this.id = config.id;
    this.type = config.type;
    this.config = config;
  }
  
  async execute(input: unknown, context: ExecutionContext): Promise<ExecutionResult> {
    const streamingContext = context as StreamingContext;

    if (this.type === 'atomic') {
        // UnifiedExecutor 不应直接处理 atomic，除非它是被错误调用的
        // 实际上，如果 config 是 atomic，应该通过 factory 创建 AgentExecutor
        throw new Error('UnifiedExecutor cannot execute atomic nodes directly. Use ExecutorFactory.');
    }

    const compositeConfig = (this.config as Extract<ExecutorConfig, { type: 'composite' }>).config;
    
    switch (compositeConfig.mode) {
      case 'serial': return this.executeSerial(input, streamingContext, compositeConfig);
      case 'parallel': return this.executeParallel(input, streamingContext, compositeConfig);
      case 'router': return this.executeRouter(input, streamingContext, compositeConfig);
      case 'loop': return this.executeLoop(input, streamingContext, compositeConfig);
      default: throw new Error(`Unknown mode: ${(compositeConfig as any).mode}`);
    }
  }

  // ========================================================
  // 编排模式实现
  // ========================================================
  
  private async executeSerial(
    input: unknown, 
    context: StreamingContext, 
    config: CompositeConfig
  ): Promise<ExecutionResult> {
    let currentInput = input;
    let lastResult: ExecutionResult | null = null;
    
    // 更新父节点元数据
    if (context.parentId) {
        context.callbacks?.onNodeMetaUpdate?.(context.parentId, { executionMode: 'sequential' });
    }
    
    for (const childConfig of config.children) {
      if (context.signal?.aborted) throw new DOMException('Aborted', 'AbortError');

      // ✨ 使用工厂或递归创建子执行器
      const child = this.createChild(childConfig);
      const childRuntimeId = generateUUID();

      // UI: 创建节点
      context.callbacks?.onNodeStart?.({
        id: childRuntimeId,
        parentId: context.parentId,
        type: child.type === 'atomic' ? 'agent' : 'router',
        name: (child as any).name || child.id,
        status: 'running',
        startTime: Date.now(),
        data: { output: '', metaInfo: { agentId: child.id } },
        children: []
      });

      // 准备子上下文
      const childContext: StreamingContext = this.createChildContext(context, childRuntimeId);

      // 执行
      try {
          lastResult = await child.execute(currentInput, childContext);
          context.callbacks?.onNodeStatus?.(childRuntimeId, lastResult.status as any);
          
          if (lastResult.control.action === 'end') break;
          currentInput = lastResult.output;

      } catch (e: any) {
          context.callbacks?.onNodeStatus?.(childRuntimeId, 'failed');
          context.callbacks?.onOutput?.(`\nError: ${e.message}`, childRuntimeId);
          throw e;
      }
    }
    
    return lastResult || { 
        status: 'success', 
        output: currentInput, 
        control: { action: 'continue' } 
    };
  }
  
  private async executeParallel(
    input: unknown, 
    context: StreamingContext, 
    config: CompositeConfig
  ): Promise<ExecutionResult> {
    if (context.parentId) {
        context.callbacks?.onNodeMetaUpdate?.(context.parentId, { 
            executionMode: 'concurrent',
            batchSize: config.children.length 
        });
    }

    const tasks = config.children.map(childConfig => ({
        executor: this.createChild(childConfig),
        runtimeId: generateUUID()
    }));

    // UI: 批量创建节点
    tasks.forEach(({ executor, runtimeId }) => {
        context.callbacks?.onNodeStart?.({
            id: runtimeId,
            parentId: context.parentId,
            name: (executor as any).name || executor.id,
            type: executor.type === 'atomic' ? 'agent' : 'router',
            status: 'running',
            startTime: Date.now(),
            data: { output: '', metaInfo: { agentId: executor.id } },
            children: []
        });
    });

    const promises = tasks.map(async ({ executor, runtimeId }) => {
        const childContext = this.createChildContext(context, runtimeId);
        try {
            const result = await executor.execute(input, childContext);
            context.callbacks?.onNodeStatus?.(runtimeId, result.status as any);
            return result;
        } catch (e: any) {
            context.callbacks?.onNodeStatus?.(runtimeId, 'failed');
            context.callbacks?.onOutput?.(`\nError: ${e.message}`, runtimeId);
            return { status: 'failed', output: null, control: { action: 'continue' } } as ExecutionResult;
        }
    });

    const results = await Promise.all(promises);
    return {
      status: results.every(r => r.status === 'success') ? 'success' : 'partial',
      output: results.map(r => r.output),
      control: { action: 'end' }
    };
  }

  // Router, Loop impl omitted for brevity (similar pattern)
  private async executeRouter(input: unknown, context: StreamingContext, config: CompositeConfig): Promise<ExecutionResult> {
      // 简化实现：默认第一个
      if (config.children.length === 0) return { status: 'success', output: input, control: { action: 'end' } };
      const child = this.createChild(config.children[0]);
      return child.execute(input, context);
  }

  private async executeLoop(input: unknown, context: StreamingContext, config: CompositeConfig): Promise<ExecutionResult> {
      // 简化实现：执行一次
       return this.executeSerial(input, context, config);
  }

  // ========================================================
  // 辅助方法
  // ========================================================

  private createChild(config: ExecutorConfig): IExecutor {
      if (this.childFactory) {
          return this.childFactory(config);
      }
      if (config.type === 'composite') {
          return new UnifiedExecutor(config); // 递归创建自身
      }
      throw new Error(`Cannot instantiate atomic node ${config.id} without ExecutorFactory`);
  }

  private createChildContext(parentContext: StreamingContext, childId: string): StreamingContext {
      return {
          ...parentContext,
          parentId: childId,
          depth: parentContext.depth + 1,
          callbacks: {
              ...parentContext.callbacks,
              onThinking: (d, id) => parentContext.callbacks?.onThinking?.(d, id || childId),
              onOutput: (d, id) => parentContext.callbacks?.onOutput?.(d, id || childId),
              onNodeStatus: (id, s) => parentContext.callbacks?.onNodeStatus?.(id || childId, s),
              onNodeMetaUpdate: (id, m) => parentContext.callbacks?.onNodeMetaUpdate?.(id || childId, m)
          }
      };
  }
}

// 辅助工厂函数 (Helpers)
export function createOrchestrator(
  config: Omit<CompositeConfig, 'children'> & { id: string, name?: string },
  children: ExecutorConfig[]
): ExecutorConfig {
  return {
    id: config.id,
    name: config.name || config.id,
    type: 'composite',
    config: { ...config, children }
  };
}