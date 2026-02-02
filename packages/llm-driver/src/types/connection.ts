// @file: llm-driver/types/connection.ts

/**
 * LLM 模型定义
 */
export interface LLMModel {
    /** 模型 ID (用于 API 调用) */
    id: string;
    
    /** 显示名称 */
    name: string;
    
    icon?: string;

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
    /** 支持音频输入 */
    supportsAudioInput?: boolean;
    /** 支持音频输出 */
    supportsAudioOutput?: boolean;
    /** 支持视频 */
    supportsVideo?: boolean;
    /** 支持结构化输出 */
    supportsStructuredOutput?: boolean;
    /** 支持代码执行 */
    supportsCodeExecution?: boolean;
    /** 支持 Computer Use */
    supportsComputerUse?: boolean;
    /** 支持缓存 */
    supportsCaching?: boolean;
    
    // ===== 定价 =====
    /** 输入价格 (每 1M tokens) */
    inputPrice?: number;
    
    /** 输出价格 (每 1M tokens) */
    outputPrice?: number;
    /** 缓存输入价格 */
    cachedInputPrice?: number;
    /** 音频输入价格 */
    audioInputPrice?: number;
    /** 音频输出价格 */
    audioOutputPrice?: number;
    
    // ===== 元数据 =====
    
    /** 发布日期 */
    releaseDate?: string;
    /** 是否已弃用 */
    deprecated?: boolean;
    /** 替代模型 */
    replacement?: string;
    /** 知识截止日期 */
    knowledgeCutoff?: string;
}

/**
 * LLM Provider 静态定义（元数据）
 * 用于 UI 展示和默认配置
 */
export interface LLMProviderDefinition {
    /** 显示名称 */
    name: string;
    
    /** 底层实现策略 */
    implementation: 'openai-compatible' | 'anthropic' | 'gemini' | 'custom';
    
    /** 默认 API 地址 */
    baseURL: string;
    
    /** 预设模型列表 */
    models: LLMModel[];
    
    /** 是否支持思维链 */
    supportsThinking?: boolean;
    
    /** 是否需要 Referer 头 (如 OpenRouter) */
    requiresReferer?: boolean;
    
    /** 详细能力 */
    capabilities?: import('./provider').ProviderCapabilities;
    
    // ===== UI =====
    /** 图标 (可选) */
    icon?: string;
    description?: string;
    docsUrl?: string;
    
    // ===== 认证 =====
    
    /** 认证方式 */
    authType?: 'bearer' | 'api-key' | 'custom';
    /** 认证头名称 */
    authHeader?: string;
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
        
        // ===== 新增字段 =====
        
        /** 默认音频配置 */
        audio?: {
            voice?: string;
            inputFormat?: string;
            outputFormat?: string;
        };
        
        /** MCP 服务器列表 */
        mcpServers?: string[];
        
        /** 缓存配置 */
        caching?: {
            enabled?: boolean;
            ttl?: number;
        };
        
        /** 自定义请求头 */
        headers?: Record<string, string>;
        
        [key: string]: any;
    };
    
    // ===== 新增字段 =====
    
    /** 连接状态 */
    status?: 'active' | 'inactive' | 'error';
    
    /** 最后测试时间 */
    lastTestedAt?: number;
    
    /** 最后测试结果 */
    lastTestResult?: {
        success: boolean;
        latency?: number;
        error?: string;
    };
    
    /** 创建时间 */
    createdAt?: number;
    
    /** 更新时间 */
    updatedAt?: number;
}
