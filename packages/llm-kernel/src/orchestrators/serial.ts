// @file: llm-kernel/orchestrators/serial.ts

import { BaseOrchestrator } from './base-orchestrator';
import { IExecutionContext } from '../core/execution-context';
import { ExecutionResult } from '../core/types';

/**
 * 串行编排器 - 按顺序执行子节点
 */
export class SerialOrchestrator extends BaseOrchestrator {
    
    async execute(input: unknown, context: IExecutionContext): Promise<ExecutionResult> {
        let currentInput = input;
        let lastResult: ExecutionResult | null = null;
        
        context.events.emit('node:start', {
            executorId: this.id,
            mode: 'serial',
            childCount: this.children.length
        });
        
        for (let i = 0; i < this.children.length; i++) {
            context.checkCancelled();
            
            const child = this.children[i];
            
            try {
                lastResult = await this.executeChild(child, currentInput, context);
                
                // 检查控制指令
                if (lastResult.control.action === 'end') {
                    break;
                }
                
                if (lastResult.control.action === 'route') {
                    // 跳转到指定节点
                    const targetIndex = this.children.findIndex(
                        c => c.id === lastResult!.control.target
                    );
                    if (targetIndex !== -1) {
                        i = targetIndex - 1; // 循环会 +1
                    }
                }
                
                // 传递输出给下一个节点
                currentInput = lastResult.output;
                
            } catch (error: any) {
                // 检查是否可重试
                if (this.config.constraints?.maxRetries && lastResult?.errors?.[0]?.recoverable) {
                    // 重试逻辑
                    context.events.emit('execution:progress', {
                        action: 'retry',
                        childId: child.id
                    });
                    i--; // 重试当前节点
                    continue;
                }
                
                throw error;
            }
        }
        
        return lastResult || {
            status: 'success',
            output: currentInput,
            control: { action: 'end' }
        };
    }
}
