// @file: llm-kernel/src/orchestrators/loop.ts

import { BaseOrchestrator } from './base-orchestrator';
import { OrchestratorConfig } from '../core/interfaces';
import { IExecutionContext } from '../core/execution-context';
import { ExecutionResult } from '../core/types';

/**
 * 循环配置
 */
export interface LoopConfig {
    /** 最大迭代次数 */
    maxIterations: number;
    
    /** 退出条件表达式 */
    exitCondition?: string;
    
    /** 每次迭代之间的延迟 (ms) */
    iterationDelay?: number;
    
    /** 是否收集所有迭代结果 */
    collectResults?: boolean;
}

/**
 * 循环编排器
 * 重复执行子节点直到满足退出条件
 */
export class LoopOrchestrator extends BaseOrchestrator {
    private loopConfig: LoopConfig;
    
    constructor(
        id: string,
        name: string,
        config: OrchestratorConfig,
        factory: any
    ) {
        super(id, name, config, factory);
        this.loopConfig = config.modeConfig?.loop || { maxIterations: 10 };
    }
    
    async execute(input: unknown, context: IExecutionContext): Promise<ExecutionResult> {
        const { maxIterations, exitCondition, iterationDelay, collectResults } = this.loopConfig;
        
        context.events.emit('node:start', {
            executorId: this.id,
            mode: 'loop',
            maxIterations
        });
        
        let currentInput = input;
        let iteration = 0;
        const results: ExecutionResult[] = [];
        
        while (iteration < maxIterations) {
            // 检查取消
            context.checkCancelled();
            
            // 更新迭代变量
            context.variables.set('_iteration', iteration);
            context.variables.set('_isFirstIteration', iteration === 0);
            context.variables.set('_isLastIteration', iteration === maxIterations - 1);
            
            // 发送进度事件
            context.events.emit('execution:progress', {
                action: 'loop_iteration',
                iteration,
                maxIterations
            });
            
            // 执行所有子节点（串行）
            let lastResult: ExecutionResult | null = null;
            
            for (const child of this.children) {
                context.checkCancelled();
                
                try {
                    lastResult = await this.executeChild(child, currentInput, context);
                    
                    // 检查控制指令
                    if (lastResult.control.action === 'end') {
                        // 立即退出循环
                        if (collectResults && lastResult) {
                            results.push(lastResult);
                        }
                        return this.buildFinalResult(results, lastResult);
                    }
                    
                    // 传递输出给下一个子节点
                    currentInput = lastResult.output;
                    
                } catch (error: any) {
                    // 错误时退出循环
                    return {
                        status: 'failed',
                        output: collectResults ? results.map(r => r.output) : null,
                        control: { action: 'end', reason: error.message },
                        errors: [{
                            code: 'LOOP_ERROR',
                            message: error.message,
                            recoverable: false
                        }]
                    };
                }
            }
            
            // 收集结果
            if (collectResults && lastResult) {
                results.push(lastResult);
            }
            
            // 检查退出条件
            if (exitCondition && this.evaluateExitCondition(exitCondition, currentInput, context)) {
                context.events.emit('execution:progress', {
                    action: 'loop_exit',
                    reason: 'condition_met',
                    iteration
                });
                break;
            }
            
            // 迭代延迟
            if (iterationDelay && iteration < maxIterations - 1) {
                await this.sleep(iterationDelay);
            }
            
            iteration++;
        }
        
        // 达到最大迭代次数
        if (iteration >= maxIterations) {
            context.events.emit('execution:progress', {
                action: 'loop_exit',
                reason: 'max_iterations',
                iteration
            });
        }
        
        return this.buildFinalResult(results, results[results.length - 1] || null);
    }
    
    /**
     * 评估退出条件
     */
    private evaluateExitCondition(
        condition: string,
        currentOutput: unknown,
        context: IExecutionContext
    ): boolean {
        try {
            const vars = {
                output: currentOutput,
                iteration: context.variables.get('_iteration'),
                ...context.variables.toObject()
            };
            
            // 简单表达式求值
            const fn = new Function(...Object.keys(vars), `return ${condition}`);
            return Boolean(fn(...Object.values(vars)));
        } catch (e) {
            console.warn('[LoopOrchestrator] Failed to evaluate exit condition:', e);
            return false;
        }
    }
    
    /**
     * 构建最终结果
     */
    private buildFinalResult(
        results: ExecutionResult[],
        lastResult: ExecutionResult | null
    ): ExecutionResult {
        const hasFailure = results.some(r => r.status === 'failed');
        
        return {
            status: hasFailure ? 'partial' : 'success',
            output: this.loopConfig.collectResults 
                ? results.map(r => r.output) 
                : (lastResult?.output || null),
            control: { action: 'continue' },
            metadata: {
                executorId: this.id,
                executorType: this.type,
                startTime: Date.now(),
                totalIterations: results.length
            }
        };
    }
    
    /**
     * 延迟
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
