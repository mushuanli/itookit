// @file: llm-kernel/executors/http-executor.ts

import { IExecutor, ExecutorConfig } from '../core/interfaces';
import { IExecutionContext } from '../core/execution-context';
import { ExecutionResult, ExecutorType } from '../core/types';

/**
 * HTTP 执行器配置
 */
export interface HttpExecutorConfig extends ExecutorConfig {
    type: 'http';
    url: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    headers?: Record<string, string>;
    
    // 请求体模板（支持变量替换）
    bodyTemplate?: string;
    
    // 响应处理
    responseType?: 'json' | 'text' | 'blob';
    extractPath?: string;  // JSONPath 提取
    
    // 重试配置
    retryOn?: number[];  // 如 [502, 503, 504]
    maxRetries?: number;
    retryDelay?: number;
}

/**
 * HTTP 执行器 - 处理 HTTP 请求
 */
export class HttpExecutor implements IExecutor {
    readonly type: ExecutorType = 'http';
    
    constructor(
        public readonly id: string,
        public readonly name: string,
        private config: HttpExecutorConfig
    ) {}
    
    async execute(input: unknown, context: IExecutionContext): Promise<ExecutionResult> {
        const startTime = Date.now();
        
        context.events.emit('node:start', {
            executorId: this.id,
            executorType: this.type,
            url: this.config.url,
            method: this.config.method
        });
        
        try {
            // 1. 构建请求
            const url = this.interpolate(this.config.url, input, context);
            const body = this.buildBody(input, context);
            const headers = this.buildHeaders(context);
            
            // 2. 执行请求（带重试）
            const response = await this.fetchWithRetry(url, {
                method: this.config.method,
                headers,
                body,
                signal: context.signal
            });
            
            // 3. 处理响应
            const result = await this.parseResponse(response);
            const output = this.extractOutput(result);
            
            return {
                status: 'success',
                output,
                control: { action: 'continue' },
                metadata: {
                    executorId: this.id,
                    executorType: this.type,
                    startTime,
                    endTime: Date.now(),
                    statusCode: response.status,
                    url
                }
            };
            
        } catch (error: any) {
            context.emitError(error);
            
            return {
                status: 'failed',
                output: null,
                control: { action: 'end', reason: error.message },
                errors: [{
                    code: 'HTTP_ERROR',
                    message: error.message,
                    recoverable: false
                }]
            };
        }
    }
    
    private async fetchWithRetry(
        url: string, 
        options: RequestInit, 
        attempt = 1
    ): Promise<Response> {
        try {
            const response = await fetch(url, options);
            
            // 检查是否需要重试
            if (
                this.config.retryOn?.includes(response.status) &&
                attempt < (this.config.maxRetries || 3)
            ) {
                await this.delay(this.config.retryDelay || 1000);
                return this.fetchWithRetry(url, options, attempt + 1);
            }
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            return response;
        } catch (error: any) {
            if (error.name === 'AbortError') throw error;
            
            if (attempt < (this.config.maxRetries || 3)) {
                await this.delay(this.config.retryDelay || 1000);
                return this.fetchWithRetry(url, options, attempt + 1);
            }
            throw error;
        }
    }
    
    private interpolate(template: string, input: unknown, context: IExecutionContext): string {
        let result = template;
        
        // 替换 {{input}} 
        if (typeof input === 'string') {
            result = result.replace(/\{\{input\}\}/g, encodeURIComponent(input));
        }
        
        // 替换 {{var.xxx}}
        const vars = context.variables.toObject();
        result = result.replace(/\{\{var\.(\w+)\}\}/g, (_, key) => {
            return encodeURIComponent(String(vars[key] || ''));
        });
        
        return result;
    }
    
    private buildBody(input: unknown, context: IExecutionContext): string | undefined {
        if (this.config.method === 'GET') return undefined;
        
        if (this.config.bodyTemplate) {
            return this.interpolate(this.config.bodyTemplate, input, context);
        }
        
        if (input && typeof input === 'object') {
            return JSON.stringify(input);
        }
        
        return typeof input === 'string' ? input : undefined;
    }
    
    private buildHeaders(_context: IExecutionContext): Record<string, string> {
        return {
            'Content-Type': 'application/json',
            ...this.config.headers
        };
    }
    
    private async parseResponse(response: Response): Promise<any> {
        switch (this.config.responseType) {
            case 'text': return response.text();
            case 'blob': return response.blob();
            default: return response.json();
        }
    }
    
    private extractOutput(result: any): any {
        if (!this.config.extractPath) return result;
        
        // 简单的路径提取 (e.g., "data.items[0].name")
        const parts = this.config.extractPath.split('.');
        let current = result;
        
        for (const part of parts) {
            const match = part.match(/^(\w+)(?:\[(\d+)\])?$/);
            if (!match) break;
            
            current = current?.[match[1]];
            if (match[2] !== undefined) {
                current = current?.[parseInt(match[2])];
            }
        }
        
        return current;
    }
    
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
