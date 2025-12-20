// @file: llm-kernel/src/executors/script-executor.ts

import { BaseExecutor } from './base-executor';
import { ExecutorConfig } from '../core/interfaces';
import { IExecutionContext } from '../core/execution-context';
import { ExecutionResult, ExecutorType } from '../core/types';

/**
 * 脚本语言类型
 */
export type ScriptLanguage = 'javascript' | 'expression';

/**
 * 脚本执行器配置
 */
export interface ScriptExecutorConfig extends ExecutorConfig {
    type: 'script';
    
    /** 脚本语言 */
    language: ScriptLanguage;
    
    /** 脚本代码 */
    code: string;
    
    /** 超时时间 (ms) */
    timeout?: number;
    
    /** 是否启用沙箱 */
    sandbox?: boolean;
}

/**
 * 沙箱环境
 */
interface SandboxEnvironment {
    input: unknown;
    context: {
        variables: Record<string, any>;
        emit: (content: string) => void;
        setVariable: (key: string, value: any) => void;
    };
    console: {
        log: (...args: any[]) => void;
        error: (...args: any[]) => void;
        warn: (...args: any[]) => void;
    };
    // 安全的全局对象
    JSON: typeof JSON;
    Math: typeof Math;
    Date: typeof Date;
    Array: typeof Array;
    Object: typeof Object;
    String: typeof String;
    Number: typeof Number;
    Boolean: typeof Boolean;
    Promise: typeof Promise;
    setTimeout: typeof setTimeout;
    clearTimeout: typeof clearTimeout;
}

/**
 * 脚本执行器
 * 执行 JavaScript 脚本或表达式
 */
export class ScriptExecutor extends BaseExecutor {
    readonly type: ExecutorType = 'script' as ExecutorType;
    
    private language: ScriptLanguage;
    private code: string;
    private timeout: number;
    
    constructor(
        id: string,
        name: string,
        config: ScriptExecutorConfig
    ) {
        super(id, name, config);
        this.language = config.language;
        this.code = config.code;
        this.timeout = config.timeout || 30000;
    }
    
    protected async doExecute(
        input: unknown,
        context: IExecutionContext
    ): Promise<ExecutionResult> {
        switch (this.language) {
            case 'javascript':
                return this.executeJavaScript(input, context);
            case 'expression':
                return this.executeExpression(input, context);
            default:
                throw new Error(`Unsupported language: ${this.language}`);
        }
    }
    
    /**
     * 执行 JavaScript 代码
     */
    private async executeJavaScript(
        input: unknown,
        context: IExecutionContext
    ): Promise<ExecutionResult> {
        // 1. 创建沙箱环境
        const sandbox = this.createSandbox(input, context);
        
        // 2. 构建异步函数
        const asyncWrapper = `
            return (async () => {
                ${this.code}
            })();
        `;
        
        try {
            // 3. 使用 Function 构造器创建函数（生产环境应使用更安全的沙箱）
            const fn = new Function(...Object.keys(sandbox), asyncWrapper);
            
            // 4. 带超时执行
            const result = await this.executeWithTimeout(
                () => fn(...Object.values(sandbox)),
                this.timeout
            );
            
            return {
                status: 'success',
                output: result,
                control: { action: 'continue' }
            };
            
        } catch (error: any) {
            return {
                status: 'failed',
                output: null,
                control: { action: 'end', reason: error.message },
                errors: [{
                    code: 'SCRIPT_ERROR',
                    message: error.message,
                    recoverable: false
                }]
            };
        }
    }
    
    /**
     * 执行表达式（简单求值）
     */
    private async executeExpression(
        input: unknown,
        context: IExecutionContext
    ): Promise<ExecutionResult> {
        const vars = context.variables.toObject();
        const inputStr = typeof input === 'string' ? input : JSON.stringify(input);
        
        try {
            // 简单的表达式求值
            const result = this.evaluateExpression(this.code, {
                input: inputStr,
                ...vars
            });
            
            return {
                status: 'success',
                output: result,
                control: { action: 'continue' }
            };
            
        } catch (error: any) {
            return {
                status: 'failed',
                output: null,
                control: { action: 'end', reason: error.message },
                errors: [{
                    code: 'EXPRESSION_ERROR',
                    message: error.message,
                    recoverable: false
                }]
            };
        }
    }
    
    /**
     * 创建沙箱环境
     */
    private createSandbox(input: unknown, context: IExecutionContext): SandboxEnvironment {
        const logs: string[] = [];
        
        return {
            input,
            context: {
                variables: context.variables.toObject(),
                emit: (content: string) => {
                    context.emitContent(content);
                },
                setVariable: (key: string, value: any) => {
                    context.variables.set(key, value);
                }
            },
            console: {
                log: (...args: any[]) => {
                    const message = args.map(a => 
                        typeof a === 'object' ? JSON.stringify(a) : String(a)
                    ).join(' ');
                    logs.push(message);
                    context.emitContent(message + '\n');
                },
                error: (...args: any[]) => {
                    const message = '[ERROR] ' + args.join(' ');
                    logs.push(message);
                    context.emitContent(message + '\n');
                },
                warn: (...args: any[]) => {
                    const message = '[WARN] ' + args.join(' ');
                    logs.push(message);
                    context.emitContent(message + '\n');
                }
            },
            JSON,
            Math,
            Date,
            Array,
            Object,
            String,
            Number,
            Boolean,
            Promise,
            setTimeout,
            clearTimeout
        };
    }
    
    /**
     * 简单表达式求值
     */
    private evaluateExpression(expr: string, vars: Record<string, any>): any {
        // 支持的操作符和函数
        const safeExpr = expr
            .replace(/\b(input)\b/g, 'vars.input')
            .replace(/\bvars\.(\w+)/g, (_, key) => `vars["${key}"]`);
        
        const fn = new Function('vars', `return ${safeExpr}`);
        return fn(vars);
    }
    
    /**
     * 带超时执行
     */
    private executeWithTimeout<T>(fn: () => Promise<T>, timeout: number): Promise<T> {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error(`Script execution timed out after ${timeout}ms`));
            }, timeout);
            
            fn()
                .then(result => {
                    clearTimeout(timeoutId);
                    resolve(result);
                })
                .catch(error => {
                    clearTimeout(timeoutId);
                    reject(error);
                });
        });
    }
    
    /**
     * 验证输入
     */
    validate(_input: unknown): { valid: boolean; errors?: string[] } {
        // 脚本执行器允许任何输入
        return { valid: true };
    }
}

/**
 * 创建脚本执行器的便捷函数
 */
export function createScriptExecutor(
    name: string,
    code: string,
    options?: {
        language?: ScriptLanguage;
        timeout?: number;
    }
): ScriptExecutor {
    return new ScriptExecutor(
        `script-${name}`,
        name,
        {
            id: `script-${name}`,
            name,
            type: 'script' as any,
            language: options?.language || 'javascript',
            code,
            timeout: options?.timeout
        }
    );
}
