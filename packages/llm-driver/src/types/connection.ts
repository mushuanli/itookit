// @file: llm-driver/types/connection.ts

/**
 * LLM 模型定义
 */
export interface LLMModel {
    /** 模型 ID (用于 API 调用) */
    id: string;
    
    /** 显示名称 */
    name: string;
    
    /** 上下文窗口大小 (tokens) */
    contextWindow?: number;
    
    /** 最大输出 tokens */
    maxOutput?: number;
    
    /** 是否支持视觉/多模态 */
    supportsVision?: boolean;
    
    /** 是否支持思考过程 (CoT) */
    supportsThinking?: boolean;
    
    /** 是否支持工具调用 */
    supportsTools?: boolean;
    
    /** 输入价格 (每 1M tokens) */
    inputPrice?: number;
    
    /** 输出价格 (每 1M tokens) */
    outputPrice?: number;
}

/**
 * LLM Provider 静态定义（元数据）
 * 用于 UI 展示和默认配置
 */
export interface LLMProviderDefinition {
    /** 显示名称 */
    name: string;
    
    /** 底层实现策略 */
    implementation: 'openai-compatible' | 'anthropic' | 'gemini';
    
    /** 默认 API 地址 */
    baseURL: string;
    
    /** 预设模型列表 */
    models: LLMModel[];
    
    /** 是否支持思维链 */
    supportsThinking?: boolean;
    
    /** 是否需要 Referer 头 (如 OpenRouter) */
    requiresReferer?: boolean;
    
    /** 图标 (可选) */
    icon?: string;
}

/**
 * LLM 连接配置（用户实例）
 * 保存在用户设置中的实际数据结构
 */
export interface LLMConnection {
    /** 唯一标识 */
    id: string;
    
    /** 用户自定义名称 */
    name: string;
    
    /** Provider key (对应 LLM_PROVIDER_DEFAULTS 的 key) */
    provider: string;
    
    /** API Key */
    apiKey: string;
    
    /** 默认模型 ID */
    model: string;
    
    /** API 地址 (可覆盖默认值) */
    baseURL?: string;
    
    /** 当前连接可用的模型列表 */
    availableModels?: LLMModel[];
    
    /** 额外配置 */
    metadata?: {
        /** Anthropic thinking budget */
        thinkingBudget?: number;
        /** OpenAI reasoning effort */
        reasoningEffort?: 'low' | 'medium' | 'high';
        /** Organization ID */
        organizationId?: string;
        /** 是否为系统默认 */
        isSystemDefault?: boolean;
        [key: string]: any;
    };
}
