// Type definitions for @itookit/llmdriver

export interface LLMClientConfig {
    provider: string;
    apiKey: string;
    apiBaseUrl?: string;
    model?: string;
    storageAdapter?: IFileStorageAdapter;
    hooks?: {
        beforeRequest?: (params: any) => Promise<any>;
        afterResponse?: (response: any) => Promise<any>;
        onError?: (error: Error, params: any) => Promise<void>;
    };
    maxRetries?: number;
    retryDelay?: number;
    timeout?: number;
    customProviderDefaults?: Record<string, ProviderConfig>;
}

export interface ProviderConfig {
    name: string;
    implementation: 'openai-compatible' | 'anthropic' | 'gemini';
    baseURL: string;
    supportsThinking?: boolean;
    models: Array<{ id: string; name: string }>;
}

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string | MessageContent[];
}

export interface MessageContent {
    type: 'text' | 'image_url' | 'document';
    text?: string;
    image_url?: { url: string };
    document?: { url: string };
}

export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

export interface ChatCompletionParams {
    messages: ChatMessage[];
    model?: string;
    stream?: boolean;
    thinking?: boolean;
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    tools?: any[];
    toolChoice?: any;
    signal?: AbortSignal;
}

export interface ChatCompletionResponse {
    choices: Array<{
        message: {
            role: 'assistant';
            content: string;
            thinking?: string;
            tool_calls?: ToolCall[];
        };
        finish_reason: string;
    }>;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
    model: string;
}

export interface ChatCompletionChunk {
    choices: Array<{
        delta: {
            content?: string;
            thinking?: string;
            tool_calls?: any[];
        };
        finish_reason: string | null;
    }>;
}

export interface ChatInterface {
    // Overload for streaming
    create(params: ChatCompletionParams & { stream: true }): Promise<AsyncGenerator<ChatCompletionChunk>>;
    // Overload for non-streaming
    create(params: ChatCompletionParams & { stream?: false }): Promise<ChatCompletionResponse>;
    // General signature
    create(params: ChatCompletionParams): Promise<ChatCompletionResponse | AsyncGenerator<ChatCompletionChunk>>;
}

export class LLMDriver {
    constructor(config: LLMClientConfig);
    chat: ChatInterface;
}

export class LLMChain {
    constructor(client: LLMDriver);
    add(stepConfig: {
        promptTemplate: string;
        inputVariables: string[];
        outputVariable: string;
    }, llmConfig?: any): LLMChain;
    run(initialContext?: Record<string, any>): Promise<Record<string, any>>;
}

export class LLMError extends Error {
    constructor(message: string, details: {
        cause?: Error;
        provider: string;
        statusCode?: number;
    });
    provider: string;
    statusCode?: number;
}

export interface IFileStorageAdapter {
    upload(file: File, metadata?: any): Promise<{
        url: string;
        id: string;
        name: string;
        size: number;
        type: string;
    }>;
    delete(fileId: string): Promise<void>;
}

export class FileStorageAdapter implements IFileStorageAdapter {
    upload(file: File, metadata?: any): Promise<any>;
    delete(fileId: string): Promise<void>;
}

export function testLLMConnection(config: {
    provider: string;
    apiKey: string;
    baseURL?: string;
    model?: string;
}): Promise<{ success: boolean; message: string }>;

export function processAttachment(
    source: File | Blob | Buffer | string,
    mimeType?: string
): Promise<{ mimeType: string; base64: string }>;

export const LLM_PROVIDER_DEFAULTS: Record<string, ProviderConfig>;
