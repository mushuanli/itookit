// @file: llm-kernel/executors/index.ts

import { IExecutor, IExecutorFactory, ExecutorConfig, OrchestratorConfig } from '../core/interfaces';
import { ExecutorType, OrchestrationMode } from '../core/types';
import { AgentExecutor, AgentExecutorConfig } from './agent-executor';
import { HttpExecutor, HttpExecutorConfig } from './http-executor';
import { SerialOrchestrator } from '../orchestrators/serial';
import { ParallelOrchestrator } from '../orchestrators/parallel';
import { RouterOrchestrator } from '../orchestrators/router';

/**
 * 执行器工厂函数类型
 */
type ExecutorCreator = (config: ExecutorConfig, factory: IExecutorFactory) => IExecutor;

/**
 * 执行器注册表 - 支持插件化扩展
 */
export class ExecutorRegistry implements IExecutorFactory {
    private executorCreators = new Map<ExecutorType, ExecutorCreator>();
    private orchestratorCreators = new Map<OrchestrationMode, ExecutorCreator>();
    private instances = new Map<string, IExecutor>();
    
    constructor() {
        this.registerBuiltins();
    }
    
    private registerBuiltins(): void {
        // 注册内置执行器
        this.registerExecutor('agent', (config) => {
            const agentConfig = config as AgentExecutorConfig;
            return new AgentExecutor(config.id, config.name, agentConfig);
        });
        
        this.registerExecutor('http', (config) => {
            const httpConfig = config as HttpExecutorConfig;
            return new HttpExecutor(config.id, config.name, httpConfig);
        });
        
        // 注册内置编排器
        this.registerOrchestrator('serial', (config, factory) => {
            return new SerialOrchestrator(config.id, config.name, config as OrchestratorConfig, factory);
        });
        
        this.registerOrchestrator('parallel', (config, factory) => {
            return new ParallelOrchestrator(config.id, config.name, config as OrchestratorConfig, factory);
        });
        
        this.registerOrchestrator('router', (config, factory) => {
            return new RouterOrchestrator(config.id, config.name, config as OrchestratorConfig, factory);
        });
    }
    
    /**
     * 注册执行器类型
     */
    registerExecutor(type: ExecutorType, creator: ExecutorCreator): void {
        this.executorCreators.set(type, creator);
    }
    
    /**
     * 注册编排器类型
     */
    registerOrchestrator(mode: OrchestrationMode, creator: ExecutorCreator): void {
        this.orchestratorCreators.set(mode, creator);
    }
    
    /**
     * 创建执行器实例
     */
    create(config: ExecutorConfig): IExecutor {
        // 检查缓存
        if (this.instances.has(config.id)) {
            return this.instances.get(config.id)!;
        }
        
        let executor: IExecutor;
        
        if (config.type === 'composite') {
            const orchConfig = config as OrchestratorConfig;
            const creator = this.orchestratorCreators.get(orchConfig.mode);
            
            if (!creator) {
                throw new Error(`Unknown orchestration mode: ${orchConfig.mode}`);
            }
            
            executor = creator(config, this);
        } else {
            const creator = this.executorCreators.get(config.type);
            
            if (!creator) {
                throw new Error(`Unknown executor type: ${config.type}`);
            }
            
            executor = creator(config, this);
        }
        
        this.instances.set(config.id, executor);
        return executor;
    }
    
    /**
     * 检查是否支持类型
     */
    supports(type: ExecutorType): boolean {
        return this.executorCreators.has(type) || type === 'composite';
    }
    
    /**
     * 获取已注册的类型列表
     */
    getRegisteredTypes(): { executors: ExecutorType[]; orchestrators: OrchestrationMode[] } {
        return {
            executors: Array.from(this.executorCreators.keys()),
            orchestrators: Array.from(this.orchestratorCreators.keys())
        };
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
