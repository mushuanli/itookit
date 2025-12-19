// @file: llm-kernel/orchestrators/base-orchestrator.ts

import { IExecutor, OrchestratorConfig, IExecutorFactory } from '../core/interfaces';
import { IExecutionContext } from '../core/execution-context';
import { ExecutionResult, ExecutorType } from '../core/types';

/**
 * 编排器基类
 */
export abstract class BaseOrchestrator implements IExecutor {
    readonly type: ExecutorType = 'composite';
    
    protected children: IExecutor[] = [];
    
    constructor(
        public readonly id: string,
        public readonly name: string,
        protected config: OrchestratorConfig,
        protected factory: IExecutorFactory
    ) {
        this.initializeChildren();
    }
    
    protected initializeChildren(): void {
        this.children = this.config.children.map(childConfig => 
            this.factory.create(childConfig)
        );
    }
    
    abstract execute(input: unknown, context: IExecutionContext): Promise<ExecutionResult>;
    
    /**
     * 辅助方法：执行单个子节点
     */
    protected async executeChild(
        child: IExecutor,
        input: unknown,
        context: IExecutionContext
    ): Promise<ExecutionResult> {
        const childContext = context.createChild(child.id);
        
        context.events.emit('node:start', {
            executorId: child.id,
            executorType: child.type,
            name: child.name
        }, child.id);
        
        try {
            const result = await child.execute(input, childContext);
            
            context.events.emit('node:complete', {
                executorId: child.id,
                status: result.status,
                output: result.output
            }, child.id);
            
            // 存储结果
            context.results.set(child.id, result);
            
            return result;
            
        } catch (error: any) {
            context.events.emit('node:error', {
                executorId: child.id,
                error: error.message
            }, child.id);
            
            throw error;
        }
    }
    
    /**
     * 辅助方法：合并多个结果
     */
    protected mergeResults(results: ExecutionResult[]): ExecutionResult {
        const hasFailure = results.some(r => r.status === 'failed');
        const allSuccess = results.every(r => r.status === 'success');
        
        return {
            status: allSuccess ? 'success' : hasFailure ? 'failed' : 'partial',
            output: results.map(r => r.output),
            control: { action: 'continue' },
            errors: results.flatMap(r => r.errors || [])
        };
    }
}
