/**
 * @file common/interfaces/llm/ILLM.ts
 * @description 定义 LLM 相关的核心数据结构，供 UI 配置和底层 Driver 共同使用。
 */

/**
 * 基础模型定义
 */
export interface LLMModel {
    id: string;
    name: string;
    /** 上下文窗口大小 (可选) */
    contextWindow?: number;
    /** 是否支持视觉/多模态 (可选) */
    supportsVision?: boolean;
}

/**
 * LLM 提供商的静态定义 (元数据)
 * 用于 UI 展示默认列表，以及 Driver 初始化默认配置
 */
export interface LLMProviderDefinition {
    /** 显示名称 (e.g., "OpenAI") */
    name: string;
    /** 
     * 底层实现策略 
     * 对应 Driver 中的 Provider 类 (e.g., 'openai-compatible', 'anthropic') 
     */
    implementation: 'openai-compatible' | 'anthropic' | 'gemini';
    
    /** 默认 API 地址 */
    baseURL: string;
    
    /** 预设模型列表 */
    models: LLMModel[];
    
    /** 特性开关: 是否支持思维链/思考过程 */
    supportsThinking?: boolean;
    
    /** 特性开关: 是否需要 Referer 头 (如 OpenRouter) */
    requiresReferer?: boolean;
}

/**
 * LLM 连接配置 (用户实例)
 * 这是保存在用户设置(Settings)中的实际数据结构
 */
export interface LLMConnection {
    /** UUID */
    id: string;
    
    /** 用户自定义名称 (e.g., "我的 OpenAI") */
    name: string;
    
    /** 对应 LLMProviderDefinition 的 key (e.g., 'openai', 'custom') */
    provider: string; 
    
    /** API Key (敏感数据，UI上通常只写不读或掩码显示) */
    apiKey: string;
    
    /** 选中的默认模型 ID */
    model: string;
    
    /** API 地址 (用户可覆盖默认值) */
    baseURL?: string;
    
    /** 
     * 当前连接可用的模型列表。
     * 通常初始化为 Provider 的 models，但用户可能添加自定义模型。
     */
    availableModels?: LLMModel[];
    
    /** 额外的高级配置 */
    metadata?: {
        thinkingBudget?: number;
        reasoningEffort?: 'low' | 'medium' | 'high';
        organizationId?: string;
        [key: string]: any;
    };
}

/**
 * Agent (智能体) 配置接口
 * 虽然这是应用层逻辑，但定义在 common 有助于插件开发
 */
export interface LLMAgentConfig {
    connectionId: string;
    modelName: string;
    systemPrompt?: string;
    maxHistoryLength?: number; // -1 表示无限
    temperature?: number;
    autoPrompts?: string[];
}
