// @file: llm-driver/types/response.ts

import { ChatMessage, ToolCall, ToolDefinition, MessageContentPart } from './message';

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
    toolChoice?: ToolChoice;
    
    /** 并行工具调用 (默认 true) */
    parallelToolCalls?: boolean;
    
    // ===== 结构化输出 (新增) =====
    
    /** 响应格式 - 增强版 */
    responseFormat?: ResponseFormat;
    
    // ===== 音频配置 (新增) =====
    
    /** 音频输入配置 */
    audioInput?: {
        /** 输入格式 */
        format: 'wav' | 'mp3' | 'flac' | 'opus' | 'pcm16';
    };
    
    /** 音频输出配置 */
    audioOutput?: {
        /** 输出格式 */
        format: 'wav' | 'mp3' | 'flac' | 'opus' | 'pcm16';
        /** 语音 */
        voice?: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer' | string;
    };
    
    /** 输出模态 */
    modalities?: Array<'text' | 'audio'>;
    
    // ===== 缓存控制 (新增) =====
    
    /** 启用 Prompt Caching */
    caching?: boolean | {
        /** 缓存 TTL (秒) */
        ttl?: number;
        /** 缓存键前缀 */
        keyPrefix?: string;
    };
    
    // ===== 预测输出 (新增) =====
    
    /** 预测输出 (OpenAI Predicted Output) */
    prediction?: {
        type: 'content';
        content: string | MessageContentPart[];
    };
    
    // ===== 代码执行 (新增) =====
    
    /** 启用代码执行 (Gemini) */
    codeExecution?: boolean | {
        /** 允许的语言 */
        languages?: string[];
        /** 超时 (秒) */
        timeout?: number;
    };
    
    // ===== 搜索/检索 (新增) =====
    
    /** 启用网络搜索 */
    webSearch?: boolean | {
        /** 搜索引擎 */
        engine?: 'google' | 'bing' | 'duckduckgo';
        /** 最大结果数 */
        maxResults?: number;
    };
    
    /** 启用 RAG 检索 */
    retrieval?: {
        /** 知识库 ID */
        knowledgeBaseId?: string;
        /** 检索数量 */
        topK?: number;
        /** 相似度阈值 */
        threshold?: number;
    };
    
    // ===== 其他 =====
    
    /** 中止信号 */
    signal?: AbortSignal;
    
    /** 用户标识 */
    user?: string;
    
    /** 种子 (用于可复现输出) */
    seed?: number;
    
    /** 服务层级 (OpenAI) */
    serviceTier?: 'auto' | 'default' | 'flex';
    
    /** 元数据 (透传) */
    metadata?: Record<string, any>;
}

/**
 * 工具选择策略 - 增强版
 */
export type ToolChoice = 
    | 'none' 
    | 'auto' 
    | 'required'
    | { type: 'function'; function: { name: string } }
    | { type: 'any' }  // Anthropic: 必须调用某个工具
    | { type: 'tool'; name: string };  // Anthropic: 指定工具

/**
 * 响应格式 - 增强版
 */
export type ResponseFormat = 
    | { type: 'text' }
    | { type: 'json_object' }
    | { 
        type: 'json_schema'; 
        json_schema: {
            name: string;
            description?: string;
            schema: Record<string, any>;
            strict?: boolean;
        };
    };

/**
 * 聊天完成响应 - 增强版
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
        message: AssistantMessage;
        finish_reason: FinishReason;
        /** 日志概率 */
        logprobs?: LogProbs | null;
    }>;
    
    usage?: TokenUsage;
    
    /** 系统指纹 (OpenAI) */
    system_fingerprint?: string;
    
    /** 服务层级 (OpenAI) */
    service_tier?: string;
    
    /** 缓存信息 (新增) */
    cache?: {
        /** 是否命中缓存 */
        hit: boolean;
        /** 缓存的 token 数 */
        cached_tokens?: number;
        /** 缓存创建时间 */
        created_at?: number;
    };
    
    /** 引用/来源 (新增) */
    citations?: Citation[];
}

/**
 * Assistant 消息 - 增强版
 */
export interface AssistantMessage {
    role: 'assistant';
    content: string;
    
    /** 思考过程 */
    thinking?: string;
    
    /** 工具调用 */
    tool_calls?: ToolCall[];
    
    /** 音频输出 */
    audio?: {
        id: string;
        data: string;
        transcript?: string;
        expires_at?: number;
    };
    
    /** 结构化输出 (解析后) */
    parsed?: any;
    
    /** 拒绝原因 */
    refusal?: string;
    
    /** 代码执行结果 */
    code_execution?: {
        code: string;
        language: string;
        output?: string;
        error?: string;
    };
}

/**
 * 结束原因 - 扩展
 */
export type FinishReason = 
    | 'stop' 
    | 'length' 
    | 'tool_calls' 
    | 'content_filter'
    | 'function_call'  // 兼容旧版
    | 'end_turn'       // Anthropic
    | 'max_tokens'     // Anthropic
    | 'stop_sequence'  // Anthropic
    | null;

/**
 * Token 使用统计 - 增强版
 */
export interface TokenUsage {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    
    /** 思考 tokens */
    thinking_tokens?: number;
    
    /** 缓存命中 tokens */
    cached_tokens?: number;
    
    /** 音频 tokens */
    audio_tokens?: {
        input: number;
        output: number;
    };
    
    /** 详细分解 */
    details?: {
        reasoning_tokens?: number;
        accepted_prediction_tokens?: number;
        rejected_prediction_tokens?: number;
    };
}

/**
 * 引用信息
 */
export interface Citation {
    index: number;
    url?: string;
    title?: string;
    snippet?: string;
    confidence?: number;
}

/**
 * 日志概率
 */
export interface LogProbs {
    content: Array<{
        token: string;
        logprob: number;
        bytes?: number[];
        top_logprobs?: Array<{
            token: string;
            logprob: number;
            bytes?: number[];
        }>;
    }> | null;
}

/**
 * 流式块 - 增强版
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
                type?: string;
                function?: {
                    name?: string;
                    arguments?: string;
                };
            }>;
            /** 音频增量 */
            audio?: {
                id?: string;
                data?: string;
                transcript?: string;
            };
            /** 拒绝原因 */
            refusal?: string;
        };
        finish_reason: FinishReason;
        logprobs?: LogProbs | null;
    }>;
    
    usage?: TokenUsage;
    service_tier?: string;
}
