// @file: llm-driver/types/response.ts

import { ChatMessage, ToolCall, ToolDefinition } from './message';

/**
 * 聊天完成请求参数
 */
export interface ChatCompletionParams {
    /** 消息列表 */
    messages: ChatMessage[];
    
    /** 模型 ID (可覆盖默认) */
    model?: string;
    
    /** 是否流式响应 */
    stream?: boolean;
    
    // ===== 思考过程 =====
    
    /** 是否开启思考过程 */
    thinking?: boolean;
    
    /** 思考 Token 预算 (Anthropic/Gemini) */
    thinkingBudget?: number;
    
    /** 推理努力程度 (OpenAI o1/o3) */
    reasoningEffort?: 'low' | 'medium' | 'high';
    
    // ===== 生成参数 =====
    
    /** 温度 */
    temperature?: number;
    
    /** 最大输出 tokens */
    maxTokens?: number;
    
    /** Top-P 采样 */
    topP?: number;
    
    /** 停止序列 */
    stop?: string | string[];
    
    /** 频率惩罚 */
    frequencyPenalty?: number;
    
    /** 存在惩罚 */
    presencePenalty?: number;
    
    // ===== 工具调用 =====
    
    /** 可用工具 */
    tools?: ToolDefinition[];
    
    /** 工具选择策略 */
    toolChoice?: 'none' | 'auto' | 'required' | { type: 'function'; function: { name: string } };
    
    // ===== 其他 =====
    
    /** 中止信号 */
    signal?: AbortSignal;
    
    /** 用户标识 */
    user?: string;

    /** 响应格式 */
    responseFormat?: { type: 'text' | 'json_object' };
    
    /** 种子 (用于可复现输出) */
    seed?: number;
}

/**
 * 聊天完成响应（非流式）
 */
export interface ChatCompletionResponse {
    /** 响应 ID */
    id?: string;
    
    /** 对象类型 */
    object?: string;
    
    /** 创建时间 */
    created?: number;
    
    /** 使用的模型 */
    model: string;
    
    /** 选择列表 */
    choices: Array<{
        /** 索引 */
        index?: number;
        
        /** 消息 */
        message: {
            role: 'assistant';
            content: string;
            /** 思考过程 (标准化后) */
            thinking?: string;
            /** 工具调用 */
            tool_calls?: ToolCall[];
        };
        
        /** 结束原因 */
        finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
    }>;
    
    /** Token 使用统计 */
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
        /** 思考 tokens (如果支持) */
        thinking_tokens?: number;
    };
}

/**
 * 聊天完成流式块
 */
export interface ChatCompletionChunk {
    /** 响应 ID */
    id?: string;
    
    /** 对象类型 */
    object?: string;
    
    /** 创建时间 */
    created?: number;
    
    /** 使用的模型 */
    model?: string;
    
    /** 选择列表 */
    choices: Array<{
        /** 索引 */
        index?: number;
        
        /** 增量内容 */
        delta: {
            /** 角色 (首个块) */
            role?: 'assistant';
            /** 内容增量 */
            content?: string;
            /** 思考增量 */
            thinking?: string;
            /** 工具调用增量 */
            tool_calls?: Array<{
                index: number;
                id?: string;
                type?: 'function';
                function?: {
                    name?: string;
                    arguments?: string;
                };
            }>;
        };
        
        /** 结束原因 */
        finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
    }>;
    
    /** 使用统计 (最后一个块) */
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}
