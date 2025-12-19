// @file: llm-kernel/orchestrators/parallel.ts

import { BaseOrchestrator } from './base-orchestrator';
import { IExecutionContext } from '../core/execution-context';
import { ExecutionResult } from '../core/types';
import {IExecutor} from '../core/interfaces';

/**
 * 并行编排器 - 并发执行子节点
 */
export class ParallelOrchestrator extends BaseOrchestrator {
    
    async execute(input: unknown, context: IExecutionContext): Promise<ExecutionResult> {
        const parallelConfig = this.config.modeConfig?.parallel;
        const maxConcurrency = parallelConfig?.maxConcurrency || this.children.length;
        
        context.events.emit('node:start', {
            executorId: this.id,
            mode: 'parallel',
            childCount: this.children.length,
            maxConcurrency
        });
        
        // 使用并发控制
        const results = await this.executeWithConcurrencyLimit(
            this.children,
            input,
            context,
            maxConcurrency
        );
        
        // 根据策略处理结果
        if (parallelConfig?.mergeStrategy === 'first') {
            const firstSuccess = results.find(r => r.status === 'success');
            return firstSuccess || results[0];
        }
        
        return this.mergeResults(results);
    }
    
    private async executeWithConcurrencyLimit(
        children: IExecutor[],
        input: unknown,
        context: IExecutionContext,
        limit: number
    ): Promise<ExecutionResult[]> {
        const results: ExecutionResult[] = [];
        const executing: Promise<void>[] = [];
        
        for (let i = 0; i < children.length; i++) {
            context.checkCancelled();
            
            const child = children[i];
            const index = i;
            
            const promise = this.executeChild(child, input, context)
                .then(result => {
                    results[index] = result;
                })
                .catch(error => {
                    results[index] = {
                        status: 'failed',
                        output: null,
                        control: { action: 'end' },
                        errors: [{
                            code: 'EXECUTION_ERROR',
                            message: error.message,
                            recoverable: false
                        }]
                    };
                });
            
            executing.push(promise);
            
            // 控制并发
            if (executing.length >= limit) {
                await Promise.race(executing);
                // 移除已完成的
                const completed = executing.findIndex(p => 
                    p.then(() => true).catch(() => true)
                );
                if (completed !== -1) {
                    executing.splice(completed, 1);
                }
            }
        }
        
        // 等待所有完成
        await Promise.all(executing);
        
        return results;
    }
}
