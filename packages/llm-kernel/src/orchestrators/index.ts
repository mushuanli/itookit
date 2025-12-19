// @file: llm-kernel/src/orchestrators/index.ts

import { IExecutor, IExecutorFactory, OrchestratorConfig } from '../core/interfaces';
import { OrchestrationMode } from '../core/types';
import { SerialOrchestrator } from './serial';
import { ParallelOrchestrator } from './parallel';
import { RouterOrchestrator } from './router';
import { LoopOrchestrator } from './loop';
import { DAGOrchestrator } from './dag';

/**
 * 编排器创建函数类型
 */
type OrchestratorCreator = (
    id: string,
    name: string,
    config: OrchestratorConfig,
    factory: IExecutorFactory
) => IExecutor;

/**
 * 编排器注册表
 */
class OrchestratorRegistry {
    private creators = new Map<OrchestrationMode, OrchestratorCreator>();
    
    constructor() {
        this.registerBuiltins();
    }
    
    /**
     * 注册内置编排器
     */
    private registerBuiltins(): void {
        this.register('serial', (id, name, config, factory) => 
            new SerialOrchestrator(id, name, config, factory)
        );
        
        this.register('parallel', (id, name, config, factory) => 
            new ParallelOrchestrator(id, name, config, factory)
        );
        
        this.register('router', (id, name, config, factory) => 
            new RouterOrchestrator(id, name, config, factory)
        );
        
        this.register('loop', (id, name, config, factory) => 
            new LoopOrchestrator(id, name, config, factory)
        );
        
        this.register('dag', (id, name, config, factory) => 
            new DAGOrchestrator(id, name, config, factory)
        );
    }
    
    /**
     * 注册编排器
     */
    register(mode: OrchestrationMode | string, creator: OrchestratorCreator): void {
        this.creators.set(mode as OrchestrationMode, creator);
    }
    
    /**
     * 创建编排器
     */
    create(config: OrchestratorConfig, factory: IExecutorFactory): IExecutor {
        const creator = this.creators.get(config.mode);
        
        if (!creator) {
            throw new Error(`Unknown orchestration mode: ${config.mode}`);
        }
        
        return creator(config.id, config.name, config, factory);
    }
    
    /**
     * 检查是否支持模式
     */
    supports(mode: OrchestrationMode | string): boolean {
        return this.creators.has(mode as OrchestrationMode);
    }
    
    /**
     * 获取已注册的模式列表
     */
    getRegisteredModes(): OrchestrationMode[] {
        return Array.from(this.creators.keys());
    }
}

// 单例
let registry: OrchestratorRegistry | null = null;

export function getOrchestratorRegistry(): OrchestratorRegistry {
    if (!registry) {
        registry = new OrchestratorRegistry();
    }
    return registry;
}

/**
 * 注册自定义编排器
 */
export function registerOrchestrator(
    mode: string,
    creator: OrchestratorCreator
): void {
    getOrchestratorRegistry().register(mode, creator);
}

/**
 * 创建编排器
 */
export function createOrchestrator(
    config: OrchestratorConfig,
    factory: IExecutorFactory
): IExecutor {
    return getOrchestratorRegistry().create(config, factory);
}

// 导出所有编排器类
export { BaseOrchestrator } from './base-orchestrator';
export { SerialOrchestrator } from './serial';
export { ParallelOrchestrator } from './parallel';
export { RouterOrchestrator } from './router';
export { LoopOrchestrator } from './loop';
export { DAGOrchestrator } from './dag';
