// @file: llm-kernel/cli/runner.ts

import { ExecutionRuntime, getRuntime } from '../runtime/execution-runtime';
import { ExecutorConfig } from '../core/interfaces';
import { ExecutionResult } from '../core/types';
import { getEventBus, KernelEvent } from '../core/event-bus';

/**
 * CLI 运行器配置
 */
export interface CLIRunnerOptions {
    /** 详细输出 */
    verbose?: boolean;
    
    /** 超时时间 (ms) */
    timeout?: number;
    
    /** 输出格式 */
    outputFormat?: 'text' | 'json';
    
    /** 是否显示思考过程 */
    showThinking?: boolean;
    
    /** 是否显示时间戳 */
    showTimestamp?: boolean;
}

/**
 * CLI 运行器
 * 用于在非 UI 环境（命令行、脚本）中运行 Kernel
 */
export class CLIRunner {
    private runtime: ExecutionRuntime;
    private options: CLIRunnerOptions;
    private unsubscribe?: () => void;
    
    constructor(options: CLIRunnerOptions = {}) {
        this.runtime = getRuntime();
        this.options = {
            verbose: false,
            outputFormat: 'text',
            showThinking: true,
            showTimestamp: false,
            ...options
        };
        
        if (options.verbose) {
            this.setupVerboseLogging();
        }
    }
    
    /**
     * 设置详细日志
     */
    private setupVerboseLogging(): void {
        const eventBus = getEventBus();
        
        this.unsubscribe = eventBus.on('*', (event: KernelEvent) => {
            const ts = this.options.showTimestamp 
                ? `[${new Date().toISOString()}] ` 
                : '';
            console.log(`${ts}${event.type}:`, JSON.stringify(event.payload, null, 2));
        });
    }
    
    /**
     * 执行配置
     */
    async run(
        config: ExecutorConfig,
        input: string,
        variables?: Record<string, any>
    ): Promise<{ success: boolean; output: any; errors?: any[] }> {
        const startMessage = `\n[CLI] Starting execution: ${config.name || config.id}`;
        console.log(startMessage);
        console.log(`[CLI] Input: ${this.truncate(input, 100)}\n`);
        
        const startTime = Date.now();
        
        // 设置流式输出处理
        const eventBus = getEventBus();
        let thinkingBuffer = '';
        let outputBuffer = '';
        
        const streamUnsubscribe = eventBus.on('*', (event: KernelEvent) => {
            if (event.type === 'stream:thinking' && this.options.showThinking) {
                const delta = event.payload?.delta || '';
                thinkingBuffer += delta;
                if (this.options.outputFormat === 'text') {
                    process.stdout.write(`\x1b[2m${delta}\x1b[0m`); // 灰色输出
                }
            }
            
            if (event.type === 'stream:content') {
                const delta = event.payload?.delta || '';
                outputBuffer += delta;
                if (this.options.outputFormat === 'text') {
                    process.stdout.write(delta);
                }
            }
        });
        
        try {
            const result = await this.runtime.execute(config, input, {
                variables,
                timeout: this.options.timeout
            });
            
            streamUnsubscribe();
            
            const duration = Date.now() - startTime;
            
            if (this.options.outputFormat === 'json') {
                console.log(JSON.stringify({
                    status: result.status,
                    output: result.output,
                    duration,
                    metadata: result.metadata,
                    errors: result.errors
                }, null, 2));
            } else {
                console.log(`\n\n[CLI] Completed in ${duration}ms with status: ${result.status}`);
            }
            
            return {
                success: result.status === 'success',
                output: result.output,
                errors: result.errors
            };
            
        } catch (error: any) {
            streamUnsubscribe();
            
            console.error(`\n[CLI] Execution failed: ${error.message}`);
            
            return {
                success: false,
                output: null,
                errors: [{ message: error.message }]
            };
        }
    }
    
    /**
     * 交互模式
     */
    async interactive(config: ExecutorConfig): Promise<void> {
        // 动态导入 readline（仅 Node.js 环境）
        let readline: any;
        try {
            readline = await import('readline');
        } catch {
            console.error('[CLI] Interactive mode requires Node.js environment');
            return;
        }
        
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        console.log(`\n[CLI] Interactive mode with: ${config.name || config.id}`);
        console.log('[CLI] Type "exit" or "quit" to quit');
        console.log('[CLI] Type "clear" to clear history\n');
        
        const history: Array<{ role: string; content: string }> = [];
        
        const prompt = (): void => {
            rl.question('\x1b[36mYou: \x1b[0m', async (input: string) => {
                const trimmed = input.trim().toLowerCase();
                
                if (trimmed === 'exit' || trimmed === 'quit') {
                    console.log('\n[CLI] Goodbye!');
                    rl.close();
                    return;
                }
                
                if (trimmed === 'clear') {
                    history.length = 0;
                    console.log('[CLI] History cleared\n');
                    prompt();
                    return;
                }
                
                if (!input.trim()) {
                    prompt();
                    return;
                }
                
                history.push({ role: 'user', content: input });
                
                console.log('\x1b[33mAssistant: \x1b[0m');
                
                const result = await this.run(config, input, { history });
                
                if (result.success && result.output) {
                    history.push({ role: 'assistant', content: result.output });
                }
                
                console.log('');
                prompt();
            });
        };
        
        prompt();
    }
    
    /**
     * 批量执行
     */
    async batch(
        config: ExecutorConfig,
        inputs: string[],
        options?: { parallel?: boolean; maxConcurrency?: number }
    ): Promise<Array<{ input: string; success: boolean; output: any }>> {
        const results: Array<{ input: string; success: boolean; output: any }> = [];
        
        if (options?.parallel) {
            const concurrency = options.maxConcurrency || 3;
            const chunks: string[][] = [];
            
            for (let i = 0; i < inputs.length; i += concurrency) {
                chunks.push(inputs.slice(i, i + concurrency));
            }
            
            for (const chunk of chunks) {
                const chunkResults = await Promise.all(
                    chunk.map(async (input) => {
                        const result = await this.run(config, input);
                        return { input, ...result };
                    })
                );
                results.push(...chunkResults);
            }
        } else {
            for (const input of inputs) {
                const result = await this.run(config, input);
                results.push({ input, ...result });
            }
        }
        
        return results;
    }
    
    /**
     * 清理资源
     */
    destroy(): void {
        this.unsubscribe?.();
    }
    
    /**
     * 截断字符串
     */
    private truncate(str: string, maxLength: number): string {
        if (str.length <= maxLength) return str;
        return str.substring(0, maxLength) + '...';
    }
}

/**
 * 创建 CLI Runner 的便捷函数
 */
export function createCLIRunner(options?: CLIRunnerOptions): CLIRunner {
    return new CLIRunner(options);
}
