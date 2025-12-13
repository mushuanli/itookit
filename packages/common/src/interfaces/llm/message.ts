// @file: common/interfaces/llm/message.ts

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface MessageContentText {
    type: 'text';
    text: string;
}

export interface MessageContentImage {
    type: 'image_url';
    image_url: { url: string };
}

/**
 * 文档类型 (用于 Claude/DeepSeek 等支持文档上传的模型)
 */
export interface MessageContentDocument {
    type: 'document';
    document: { url: string; mime_type?: string };
}

export type MessageContentPart = MessageContentText | MessageContentImage | MessageContentDocument;

/**
 * 消息内容：可以是简单字符串，也可以是多模态数组
 */
export type MessageContent = string | MessageContentPart[];

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * 聊天消息 - 核心定义
 * 统一了 UI、存储和 Driver 的数据结构
 */
export interface ChatMessage {
  role: Role;
  content: MessageContent;
  
  /** 发送者名称 (可选) */
  name?: string;
  
  /** 
   * 工具调用列表 (当 role='assistant' 时)
   * 注意：为了兼容性，建议在 Driver 层处理 camelCase 与 snake_case 的转换，
   * 但在此处定义标准属性名。这里采用 camelCase 以符合 JS 惯例，
   * Driver 在发送给 API 前需要转换为 snake_case。
   */
  toolCalls?: ToolCall[];
  
  /** 
   * 关联的工具调用 ID (当 role='tool' 时) 
   */
  toolCallId?: string;
}