// @file: llm-engine/adapters/kernel-adapter.ts

import {
    ExecutionRuntime,
    getRuntime,
    ExecutorConfig,
    ExecutionResult,
} from '@itookit/llm-kernel';
import { OrchestratorEvent } from '../core/types';
import { UIEventAdapter } from './ui-event-adapter';

/**
 * Kernel 适配器
 * 将 Kernel 的执行能力适配到 UI 层
 */
export class KernelAdapter {
    private runtime: ExecutionRuntime;
    private uiAdapter: UIEventAdapter;
    
    constructor() {
        this.runtime = getRuntime();
        this.uiAdapter = new UIEventAdapter();
    }
    
    /**
     * 执行查询
     */
    async executeQuery(
        input: string,
        executorConfig: ExecutorConfig,
        options: {
            sessionId: string;
            history?: Array<{ role: string; content: string }>;
            files?: File[];
            onEvent?: (event: OrchestratorEvent) => void;
            signal?: AbortSignal;
            /** ✨ [新增] 根节点 ID */
            rootNodeId?: string;
        }
    ): Promise<ExecutionResult> {
        const { sessionId, history, files, onEvent, signal, rootNodeId } = options;

        // 订阅事件并转换为 UI 事件
        let unsubscribe: (() => void) | undefined;
        
        if (onEvent) {
            unsubscribe = this.uiAdapter.bridge(sessionId, (uiEvent) => {
                onEvent(uiEvent);
            });
        }
        
        try {
            const result = await this.runtime.execute(
                executorConfig,
                input,
                {
                    variables: {
                        history: history || [],
                        files: files || [],
                        sessionId
                    },
                    signal,
                    executionId: sessionId,
                    // ✨ [新增] 传递给 Kernel
                    rootNodeId: rootNodeId 
                }
            );
            
            return result;
            
        } finally {
            unsubscribe?.();
        }
    }
    
    /**
     * 取消执行
     */
    cancel(executionId: string): boolean {
        return this.runtime.cancel(executionId);
    }
    
    /**
     * 获取运行时实例（用于高级用例）
     */
    getRuntime(): ExecutionRuntime {
        return this.runtime;
    }
    
    /**
     * 获取活跃执行数
     */
    getActiveCount(): number {
        return this.runtime.getActiveCount();
    }
}

// ============================================
// 单例管理
// ============================================

let kernelAdapter: KernelAdapter | null = null;

/**
 * 获取 KernelAdapter 单例
 */
export function getKernelAdapter(): KernelAdapter {
    if (!kernelAdapter) {
        kernelAdapter = new KernelAdapter();
    }
    return kernelAdapter;
}

/**
 * 重置 KernelAdapter（用于测试）
 */
export function resetKernelAdapter(): void {
    kernelAdapter = null;
}
