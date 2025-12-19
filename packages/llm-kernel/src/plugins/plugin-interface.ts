// @file: llm-kernel/plugins/plugin-interface.ts

import { ExecutorType, OrchestrationMode } from '../core/types';
import { IExecutor, ExecutorConfig, IExecutorFactory } from '../core/interfaces';
import {  KernelEventType } from '../core/event-bus';

/**
 * 插件元数据
 */
export interface PluginMetadata {
    id: string;
    name: string;
    version: string;
    description?: string;
    author?: string;
    dependencies?: string[];
}

/**
 * 插件接口
 */
export interface IKernelPlugin {
    readonly metadata: PluginMetadata;
    
    /**
     * 插件初始化
     */
    initialize(context: PluginContext): Promise<void>;
    
    /**
     * 插件卸载
     */
    destroy?(): Promise<void>;
}

/**
 * 插件上下文 - 提供给插件的 API
 */
export interface PluginContext {
    /**
     * 注册新的执行器类型
     */
    registerExecutor(
        type: ExecutorType | string,
        creator: (config: ExecutorConfig, factory: IExecutorFactory) => IExecutor
    ): void;
    
    /**
     * 注册新的编排模式
     */
    registerOrchestrator(
        mode: OrchestrationMode | string,
        creator: (config: ExecutorConfig, factory: IExecutorFactory) => IExecutor
    ): void;
    
    /**
     * 订阅内核事件
     */
    onEvent(type: KernelEventType | '*', handler: (event: any) => void): () => void;
    
    /**
     * 获取配置
     */
    getConfig<T>(key: string): T | undefined;
    
    /**
     * 日志
     */
    log: {
        debug(message: string, ...args: any[]): void;
        info(message: string, ...args: any[]): void;
        warn(message: string, ...args: any[]): void;
        error(message: string, ...args: any[]): void;
    };
}
