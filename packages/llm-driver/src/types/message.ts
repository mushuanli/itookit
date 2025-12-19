// @file: llm-driver/types/message.ts

/**
 * 消息角色
 */
export type Role = 'system' | 'user' | 'assistant' | 'tool';

/**
 * 文本内容
 */
export interface MessageContentText {
    type: 'text';
    text: string;
}

/**
 * 图片内容
 */
export interface MessageContentImage {
    type: 'image_url';
    image_url: {
        url: string;
        detail?: 'auto' | 'low' | 'high';
    };
}

/**
 * 文档内容
 */
export interface MessageContentDocument {
    type: 'document';
    document: {
        url: string;
        mime_type?: string;
    };
}

/**
 * 内容部分（多模态）
 */
export type MessageContentPart = 
    | MessageContentText 
    | MessageContentImage 
    | MessageContentDocument;

/**
 * 消息内容（字符串或多模态数组）
 */
export type MessageContent = string | MessageContentPart[];

/**
 * 聊天消息
 */
export interface ChatMessage {
    /** 角色 */
    role: Role;
    
    /** 内容 */
    content: MessageContent;
    
    /** 名称（用于多 Agent 场景） */
    name?: string;
    
    /** 工具调用 ID（用于 tool 角色） */
    tool_call_id?: string;
}

/**
 * 工具调用
 */
export interface ToolCall {
    id: string;
    type: 'function';
    function: {
        name: string;
        arguments: string;
    };
}

/**
 * 工具定义
 */
export interface ToolDefinition {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: Record<string, any>;
    };
}
