// @file: llm-kernel/index.ts

/**
 * @package @itookit/llm-kernel
 * @description 执行引擎核心层
 * 
 * 职责：
 * - 执行器管理（Agent、HTTP、Tool、Script）
 * - 编排器管理（Serial、Parallel、Router、Loop、DAG）
 * - 事件驱动架构
 * - 插件化扩展
 * - 运行时管理
 * 
 * 特点：
 * - 无 UI 依赖
 * - 可独立运行（CLI、Worker）
 * - 插件化、可扩展
 */

// ============================================
// 核心类型
// ============================================

export * from './core/types';
export * from './core/interfaces';
export * from './core/event-bus';
export * from './core/execution-context';

// ============================================
// 执行器
// ============================================

export { BaseExecutor } from './executors/base-executor';
export { AgentExecutor } from './executors/agent-executor';
export type { AgentExecutorConfig } from './executors/agent-executor';

export { HttpExecutor } from './executors/http-executor';
export type { HttpExecutorConfig } from './executors/http-executor';

export { ToolExecutor, createToolExecutor } from './executors/tool-executor';
export type { ToolExecutorConfig, ToolDefinition } from './executors/tool-executor';

export { ScriptExecutor, createScriptExecutor } from './executors/script-executor';
export type { ScriptExecutorConfig, ScriptLanguage } from './executors/script-executor';

export { ExecutorRegistry, getExecutorRegistry } from './executors';

// ============================================
// 编排器
// ============================================

export {
    BaseOrchestrator,
    SerialOrchestrator,
    ParallelOrchestrator,
    RouterOrchestrator,
    LoopOrchestrator,
    DAGOrchestrator,
    getOrchestratorRegistry,
    registerOrchestrator,
    createOrchestrator
} from './orchestrators';

export type { LoopConfig } from './orchestrators/loop';

// ============================================
// 运行时
// ============================================

export { ExecutionRuntime, getRuntime } from './runtime/execution-runtime';
export type { ExecutionOptions } from './runtime/execution-runtime';

export { 
    StateMachine, 
    createStateMachine,
    executionStateMachineConfig 
} from './runtime/state-machine';
export type { 
    StateDefinition, 
    StateTransition, 
    StateMachineConfig 
} from './runtime/state-machine';

export { 
    MemoryStore, 
    ScopedMemoryStore,
    createMemoryStore,
    getGlobalMemoryStore,
    resetGlobalMemoryStore
} from './runtime/memory-store';
export type { MemoryEntry, QueryOptions } from './runtime/memory-store';

// ============================================
// CLI
// ============================================

export { CLIRunner, createCLIRunner } from './cli';
export type { CLIRunnerOptions } from './cli';

// ============================================
// Worker
// ============================================

export {
    WorkerAdapter,
    WorkerClient,
    initWorker,
    createWorkerAdapter,
    createWorkerClient
} from './worker';
export type { 
    WorkerMessage, 
    WorkerResponse,
    WorkerExecuteOptions 
} from './worker';

// ============================================
// 插件系统
// ============================================

export * from './plugins/plugin-interface';
export { PluginManager, getPluginManager } from './plugins/plugin-manager';

// ============================================
// 工具函数
// ============================================

export {
    generateId,
    generateUUID,
    generateRandomString,
    generateExecutionId,
    generateNodeId,
    generateTaskId,
    generateSessionId,
    generateShortId,
    generateContentHash,
    isValidId,
    extractTimestamp,
    SequenceIdGenerator
} from './utils/id-generator';

export {
    validateExecutorConfig,
    validateOrchestratorConfig,
    validateInput,
    isValidExecutorType,
    isValidOrchestrationMode,
    isValidURL,
    isValidJSON,
    isValidExpression,
    ValidatorChain,
    createValidator
} from './utils/validators';
export type { 
    ValidationResult, 
    ValidationError, 
    ValidationWarning 
} from './utils/validators';

// ============================================
// 初始化
// ============================================

import { ExecutionRuntime, getRuntime } from './runtime/execution-runtime';
import { PluginManager, getPluginManager } from './plugins/plugin-manager';
import { IKernelPlugin } from './plugins/plugin-interface';

export interface KernelInitOptions {
    /** 插件列表 */
    plugins?: IKernelPlugin[];
    
    /** 配置 */
    config?: Record<string, any>;
}

/**
 * 初始化 Kernel
 */
export async function initializeKernel(options: KernelInitOptions = {}): Promise<{
    runtime: ExecutionRuntime;
    pluginManager: PluginManager;
}> {
    const runtime = getRuntime();
    const pluginManager = getPluginManager();
    
    // 设置配置
    if (options.config) {
        pluginManager.setConfig(options.config);
    }
    
    // 注册插件
    if (options.plugins) {
        for (const plugin of options.plugins) {
            await pluginManager.register(plugin);
        }
    }
    
    console.log('[Kernel] Initialized');
    
    return { runtime, pluginManager };
}
