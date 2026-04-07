// @file: device-tools/src/tool-service.ts
// 工具服务核心实现。

import type {
    ToolMeta,
    ToolInvokeRequest,
    ToolInvokeResult,
    ToolBatchResult,
    ToolHandler,
    ToolExecutionContext,
    IToolService,
    ToolSideEffect,
} from '@itookit/common';
import type { ToolDefinition } from '@itookit/common';
import { PermissionManager } from './permission-manager';

/**
 * 已注册工具的内部表示
 */
interface RegisteredTool {
    meta: ToolMeta;
    definition: ToolDefinition;
    handler: ToolHandler;
}

/**
 * 工具服务实现。
 *
 * 职责：
 * 1. 工具注册表管理
 * 2. 工具执行（单个 + 批量）
 * 3. 并行策略（读操作并行、写操作串行）
 * 4. 超时控制
 * 5. 错误包装（不向外抛异常——Agent 循环要求工具异常不传播）
 *
 * 设计原则：
 * - SRP: 只负责工具的注册和执行，不负责权限检查（委托给 PermissionManager）
 * - OCP: 新增工具只需调用 registerTool，不修改已有代码
 * - DIP: 依赖 ToolHandler 函数签名而非具体工具类
 */
export class ToolService implements IToolService {
    private tools = new Map<string, RegisteredTool>();
    private permissions: PermissionManager;

    constructor(permissions?: PermissionManager) {
        this.permissions = permissions ?? new PermissionManager();
    }

    listTools(): ToolMeta[] {
        return [...this.tools.values()].map(t => t.meta);
    }

    getToolMeta(id: string): ToolMeta | undefined {
        return this.tools.get(id)?.meta;
    }

    getToolDefinitions(): ToolDefinition[] {
        const defs: ToolDefinition[] = [];
        for (const tool of this.tools.values()) {
            if (tool.meta.enabled) {
                defs.push(tool.definition);
            }
        }
        return defs;
    }

    registerTool(
        meta: ToolMeta,
        definition: ToolDefinition,
        handler: ToolHandler,
    ): void {
        this.tools.set(meta.id, { meta, definition, handler });
    }

    unregisterTool(id: string): void {
        this.tools.delete(id);
    }

    async invoke(request: ToolInvokeRequest): Promise<ToolInvokeResult> {
        const startTime = Date.now();
        const tool = this.tools.get(request.toolId);

        if (!tool) {
            return {
                toolId: request.toolId,
                success: false,
                output: `Error: Unknown tool '${request.toolId}'. Available: ${[...this.tools.keys()].join(', ')}`,
                durationMs: Date.now() - startTime,
                error: 'TOOL_NOT_FOUND',
            };
        }

        if (!tool.meta.enabled) {
            return {
                toolId: request.toolId,               success: false,
                output: `Error: Tool '${request.toolId}' is currently disabled.`,
                durationMs: Date.now() - startTime,
                error: 'TOOL_DISABLED',
            };
        }

        const context: ToolExecutionContext = {
            cwd: request.cwd ?? process.cwd(),
            signal: request.signal,
            timeoutMs: request.timeoutMs ?? tool.meta.timeoutMs,
        };

        try {
            const output = await this.executeWithTimeout(
                () => tool.handler(request.args, context),
                context.timeoutMs,
                request.toolId,
                request.signal,
            );

            return {
                toolId: request.toolId,
                success: true,
                output,
                durationMs: Date.now() - startTime,
            };
        } catch (err: any) {
            const isTimeout = err.name === 'TimeoutError';
            const errorMessage = isTimeout
                ? `Tool '${request.toolId}' timed out after ${context.timeoutMs}ms. Try a simpler approach.`
                : `Tool '${request.toolId}' failed: ${err.message ?? String(err)}`;

            return {
                toolId: request.toolId,
                success: false,
                output: errorMessage,
                durationMs: Date.now() - startTime,
                error: isTimeout ? 'TIMEOUT' : 'EXECUTION_ERROR',
            };
        }
    }

    /**
     * 批量执行工具调用。
     *
     * 并行策略（参考 Claude Code 的 StreamingToolExecutor）：
     * - sideEffect='none' 的工具可以并行执行（file_read, grep 等）
     * - sideEffect='local'/'external' 的工具串行执行（file_write, shell 等）
     * - 混合时：先并行所有读操作，再串行写操作
     */
    async invokeBatch(requests: ToolInvokeRequest[]): Promise<ToolBatchResult> {
        const batchStart = Date.now();
        const { reads, writes } = this.partitionBySideEffect(requests);
        const results: ToolInvokeResult[] = [];

        // 阶段 1：并行执行读操作
        if (reads.length > 0) {
            const readResults = await Promise.allSettled(
                reads.map(req => this.invoke(req)),
            );

            for (let i = 0; i < reads.length; i++) {
                const settled = readResults[i];
                if (settled.status === 'fulfilled') {
                    results.push(settled.value);
                } else {
                    results.push({
                        toolId: reads[i].toolId,
                        success: false,
                        output: `Error: ${settled.reason?.message ?? 'Unknown error'}`,
                        durationMs: 0,
                        error: 'PARALLEL_EXECUTION_ERROR',
                    });
                }
            }
        }

        // 阶段 2：串行执行写操作
        for (const req of writes) {
            const result = await this.invoke(req);
            results.push(result);
        }

        return {
            results,
            totalDurationMs: Date.now() - batchStart,
        };
    }

    /**
     * 按副作用分类请求
     */
    private partitionBySideEffect(
        requests: ToolInvokeRequest[],
    ): { reads: ToolInvokeRequest[]; writes: ToolInvokeRequest[] } {
        const reads: ToolInvokeRequest[] = [];
        const writes: ToolInvokeRequest[] = [];

        for (const req of requests) {
            const tool = this.tools.get(req.toolId);
            if (tool && tool.meta.sideEffect === 'none') {
                reads.push(req);
            } else {
                writes.push(req);
            }
        }

        return { reads, writes };
    }

    /**
     * 带超时和取消的执行包装器
     */
    private executeWithTimeout(
        fn: () => Promise<string>,
        timeoutMs: number,
        label: string,
        signal?: AbortSignal,
    ): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            // 检查是否已经取消
            if (signal?.aborted) {
                const err = new Error(`Tool '${label}' aborted before execution`);
                err.name = 'AbortError';
                reject(err);
                return;
            }

            const timer = setTimeout(() => {
                const err = new Error(`Tool '${label}' timed out after ${timeoutMs}ms`);
                err.name = 'TimeoutError';
                reject(err);
            }, timeoutMs);

            // 监听取消信号
            const abortHandler = () => {
                clearTimeout(timer);
                const err = new Error(`Tool '${label}' aborted`);
                err.name = 'AbortError';
                reject(err);
            };
            signal?.addEventListener('abort', abortHandler, { once: true });

            fn()
                .then(result => {
                    clearTimeout(timer);
                    signal?.removeEventListener('abort', abortHandler);
                    resolve(result);
                })
                .catch(err => {
                    clearTimeout(timer);
                    signal?.removeEventListener('abort', abortHandler);
                    reject(err);
                });
        });
    }
}
