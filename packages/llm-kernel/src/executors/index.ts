// @file: llm-kernel/executors/index.ts

import { IExecutor, IExecutorFactory, ExecutorConfig } from '../core/interfaces';
import { ExecutorType } from '../core/types';
import { AgentExecutor, AgentExecutorConfig } from './agent-executor';

/**
 * 执行器工厂函数类型
 */
type ExecutorCreator = (config: ExecutorConfig, factory: IExecutorFactory) => IExecutor;

/**
 * 执行器注册表 - 支持插件化扩展
 */
export class ExecutorRegistry implements IExecutorFactory {
    private executorCreators = new Map<ExecutorType, ExecutorCreator>();
    private instances = new Map<string, IExecutor>();

    constructor() {
        this.registerBuiltins();
    }

    private registerBuiltins(): void {
        this.registerExecutor('agent', (config) => {
            const agentConfig = config as AgentExecutorConfig;
            return new AgentExecutor(config.id, config.name, agentConfig);
        });
    }

    /**
     * 注册执行器类型
     */
    registerExecutor(type: ExecutorType, creator: ExecutorCreator): void {
        this.executorCreators.set(type, creator);
    }

    /**
     * 创建执行器实例
     */
    create(config: ExecutorConfig): IExecutor {
        if (this.instances.has(config.id)) {
            return this.instances.get(config.id)!;
        }

        const creator = this.executorCreators.get(config.type);
        if (!creator) {
            throw new Error(`Unknown executor type: ${config.type}`);
        }

        const executor = creator(config, this);
        this.instances.set(config.id, executor);
        return executor;
    }

    /**
     * 检查是否支持类型
     */
    supports(type: ExecutorType): boolean {
        return this.executorCreators.has(type);
    }

    /**
     * 获取已注册的执行器类型列表
     */
    getRegisteredTypes(): ExecutorType[] {
        return Array.from(this.executorCreators.keys());
    }

    /**
     * 清除实例缓存
     */
    clearCache(): void {
        this.instances.clear();
    }
}

// 单例
let registry: ExecutorRegistry | null = null;

export function getExecutorRegistry(): ExecutorRegistry {
    if (!registry) {
        registry = new ExecutorRegistry();
    }
    return registry;
}
