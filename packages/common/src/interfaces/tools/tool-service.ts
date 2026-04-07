// @file: common/interfaces/tools/tool-service.ts
// 工具设备的服务接口定义。

import type { ToolMeta, ToolInvokeRequest, ToolInvokeResult, ToolBatchResult } from './tool-types';
import type { ToolDefinition } from '../llm/message';

/**
 * 工具设备服务接口。
 *
 * 由 device-tools 的 ToolDeviceDriver 实现。
 * llm-agent 的 ToolExecutor 通过此接口（或设备文件 ioctl）调用工具。
 */
export interface IToolService {
    /** 获取所有已注册工具的元数据列表 */
    listTools(): ToolMeta[];

    /** 获取指定工具的元数据 */
    getToolMeta(id: string): ToolMeta | undefined;

    /** 获取所有已启用工具的 LLM ToolDefinition（用于发送给模型） */
    getToolDefinitions(): ToolDefinition[];

    /** 执行单个工具调用 */
    invoke(request: ToolInvokeRequest): Promise<ToolInvokeResult>;

    /**
     * 批量执行工具调用。
     *
     * 并行策略：
     * - sideEffect='none' 的工具可以并行执行
     * - sideEffect='local'/'external' 的工具串行执行
     */
    invokeBatch(requests: ToolInvokeRequest[]): Promise<ToolBatchResult>;

    /** 注册外部工具（插件扩展用） */
    registerTool(meta: ToolMeta, definition: ToolDefinition, handler: ToolHandler): void;

    /** 注销工具 */
    unregisterTool(id: string): void;
}

/**
 * 工具执行处理器。
 *
 * 每个具体工具实现此函数签名。
 * 返回字符串形式的输出，直接作为 LLM 的 tool_result content。
 *
 * 所有异常都应在内部捕获并返回 error 描述字符串，
 * 而不是向外抛出（Agent 循环要求工具异常不传播）。
 */
export type ToolHandler = (
    args: Record<string, unknown>,
    context: ToolExecutionContext,
) => Promise<string>;

/**
 * 工具执行上下文。
 *
 * 工具处理器执行时的环境信息。
 */
export interface ToolExecutionContext {
    /** 工作目录 */
    cwd: string;
    /** 取消信号 */
    signal?: AbortSignal;
    /** 超时（毫秒） */
    timeoutMs: number;
}
