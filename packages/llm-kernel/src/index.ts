// @file: llm-kernel/index.ts
//
// Execution engine core — Executor runtime + event bus + device registry.
//
// S6: Trimmed ~60% dead code. Only exports consumed by llm-engine / app-shell.
// Deleted: CLI, Worker, PluginManager, StateMachine, MemoryStore,
//          5 Orchestrators, Script/Http/Tool Executors, validators, logger.

// ============================================
// 核心类型
// ============================================

export * from './core/types';
export * from './core/interfaces';
export * from './core/event-bus';
export * from './core/execution-context';
export { setKernelDeviceManager, getKernelDeviceManager } from './core/device-registry';

// ============================================
// 执行器
// ============================================

export { ExecutorRegistry, getExecutorRegistry } from './executors';

// ============================================
// 运行时
// ============================================

export { ExecutionRuntime, getRuntime } from './runtime/execution-runtime';
export type { ExecutionOptions } from './runtime/execution-runtime';

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

// ============================================
// 初始化
// ============================================

import { ExecutionRuntime, getRuntime } from './runtime/execution-runtime';

export interface KernelInitOptions {
    /** @deprecated Plugin system removed (S6). Accepted for backward compat, ignored. */
    plugins?: any[];
    config?: Record<string, any>;
}

/**
 * Initialize Kernel runtime.
 * S6: PluginManager initialization removed (zero plugins).
 */
export async function initializeKernel(options: KernelInitOptions = {}): Promise<{
    runtime: ExecutionRuntime;
}> {
    const runtime = getRuntime();

    if (options.config) {
        // Config stored on runtime for executor access
        (runtime as any)._config = options.config;
    }

    console.log('[Kernel] Initialized');
    return { runtime };
}
