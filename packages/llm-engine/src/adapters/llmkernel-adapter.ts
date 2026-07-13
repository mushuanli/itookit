// @file: llm-engine/adapters/llmkernel-adapter.ts
import type { ChatMessage, Attachment, ChatCompletionParams, ChatCompletionChunk } from '@itookit/common';
import { createDeviceHandle } from '@itookit/common';
import {
    ExecutionRuntime,
    getRuntime,
    ExecutorConfig,
    ExecutionResult,
    getKernelDeviceManager,
} from '@itookit/llm-kernel';
import { OrchestratorEvent } from '../core/types';
import { UIEventAdapter } from './ui-event-adapter';

export interface LLMKernelAdapterOptions {
    sessionId: string;
    history: ChatMessage[];  // ✅ 明确类型是 ChatMessage[]
    attachments: Attachment[];
    onEvent: (event: OrchestratorEvent) => void;
    signal?: AbortSignal;
    rootNodeId?: string;
    stream?: boolean;
}

/**
 * Kernel 适配器
 * 将 Kernel 的执行能力适配到 UI 层
 */
export class LLMKernelAdapter {
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
        options: LLMKernelAdapterOptions
    ): Promise<ExecutionResult> {
        const {
            sessionId,
            history,
            attachments,  // ✅ 修复：使用 attachments 而不是 files
            onEvent,
            signal,
            rootNodeId,
            stream
        } = options;

        // 订阅事件并转换为 UI 事件
        let unsubscribe: (() => void) | undefined;

        if (onEvent) {
            unsubscribe = this.uiAdapter.bridge(sessionId, (uiEvent) => {
                onEvent(uiEvent);
            });
        }

        try {
            // ✅ 修改：将 stream 参数合并到 executorConfig
            const finalConfig: ExecutorConfig = {
                ...executorConfig,
                stream: stream,  // ✅ 传递 stream 参数
            };

            const result = await this.runtime.execute(
                finalConfig,
                input,
                {
                    variables: {
                        history: history || [],
                        attachments: attachments || [],  // ✅ 修复：使用 attachments
                        sessionId
                    },
                    signal,
                    executionId: sessionId,
                    rootNodeId: rootNodeId,
                    stream: stream,  // ✅ 也传递到执行选项
                }
            );

            return result;

        } finally {
            unsubscribe?.();
        }
    }

    /**
     * Issue a raw streaming chat completion via the registered LLM device driver.
     *
     * This provides UnifiedLoopStrategy (and ClaudeCodeStrategy) with direct access
     * to the underlying stream without going through the full ExecutionRuntime pipeline.
     *
     * @param params     - ChatCompletionParams with stream: true
     * @param connectionId - LLM connection ID; defaults to 'default'
     */
    async streamRaw(
        params: ChatCompletionParams,
        connectionId = 'default',
    ): Promise<AsyncGenerator<ChatCompletionChunk>> {
        const dm = getKernelDeviceManager();
        if (!dm?.has('llm')) {
            throw new Error('LLMKernelAdapter.streamRaw: LLM device driver not registered');
        }
        const driver = dm.get('llm');
        const sessionId = await driver.open!({ nodeId: 'stream-raw', name: 'stream-raw' }, {
            connectionId,
            runMode: 'kernel' as const,
        });
        const handle = createDeviceHandle(driver, { nodeId: 'stream-raw', name: 'stream-raw', sessionId });
        return handle.ioctl('chat', { ...params, stream: true }) as Promise<AsyncGenerator<ChatCompletionChunk>>;
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

let kernelAdapter: LLMKernelAdapter | null = null;

/**
 * 获取 LLMKernelAdapter 单例
 */
export function getLLMKernelAdapter(): LLMKernelAdapter {
    if (!kernelAdapter) {
        kernelAdapter = new LLMKernelAdapter();
    }
    return kernelAdapter;
}

/**
 * 重置 KernelAdapter（用于测试）
 */
export function resetLLMKernelAdapter(): void {
    kernelAdapter = null;
}
