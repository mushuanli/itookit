// @file: llm-driver/types/message.ts

/**
 * 消息角色 - 扩展支持
 */
export type Role = 'system' | 'user' | 'assistant' | 'tool' | 'developer';

// ============================================
// 多模态内容类型 (扩展)
// ============================================

/**
 * 文本内容
 */
export interface MessageContentText {
    type: 'text';
    text: string;
    /** 缓存控制 (Anthropic) */
    cache_control?: { type: 'ephemeral' };
}

/**
 * 图片内容 - 增强版
 */
export interface MessageContentImage {
    type: 'image_url' | 'image';
    image_url?: {
        url: string;
        detail?: 'auto' | 'low' | 'high';
    };
    /** Anthropic 格式 */
    source?: {
        type: 'base64' | 'url' | 'file';
        media_type?: string;
        data?: string;
        url?: string;
        file_id?: string;
    };
}

/**
 * 音频内容 (新增)
 */
export interface MessageContentAudio {
    type: 'input_audio' | 'audio';
    input_audio?: {
        /** Base64 编码的音频数据 */
        data: string;
        /** 音频格式: wav, mp3, flac, opus, pcm16 */
        format: 'wav' | 'mp3' | 'flac' | 'opus' | 'pcm16';
    };
    /** 音频转录文本 (可选) */
    transcript?: string;
}

/**
 * 视频内容 (新增)
 */
export interface MessageContentVideo {
    type: 'video';
    video: {
        /** 视频来源 */
        source: 'url' | 'file_id' | 'base64';
        url?: string;
        file_id?: string;
        data?: string;
        /** MIME 类型 */
        mime_type?: string;
        /** 视频时长 (秒) */
        duration?: number;
    };
}

/**
 * 文件数据结构 (统一)
 */
export interface FileData {
    /** 文件来源 */
    source?: 'url' | 'file_id' | 'base64';
    url?: string;
    file_id?: string;
    data?: string;
    filename?: string;
    mime_type?: string;
}

/**
 * 文件/文档内容 - 增强版
 */
export interface MessageContentFile {
    type: 'file' | 'document';
    file?: FileData;
    /** @deprecated 使用 file 代替 */
    document?: FileData;
}

/**
 * 工具结果内容 (新增)
 */
export interface MessageContentToolResult {
    type: 'tool_result';
    tool_use_id: string;
    content: string | MessageContentPart[];
    is_error?: boolean;
}

/**
 * 代码执行结果 (新增 - Gemini Code Execution)
 */
export interface MessageContentCodeExecution {
    type: 'code_execution_result';
    outcome: 'success' | 'error';
    output?: string;
    error?: string;
}

/**
 * 引用/来源 (新增)
 */
export interface MessageContentCitation {
    type: 'citation';
    citation: {
        /** 引用索引 */
        index: number;
        /** 来源 URL */
        url?: string;
        /** 来源标题 */
        title?: string;
        /** 引用文本片段 */
        snippet?: string;
        /** 置信度 */
        confidence?: number;
    };
}

/**
 * 内容部分（多模态）- 扩展版
 */
export type MessageContentPart =
    | MessageContentText
    | MessageContentImage
    | MessageContentAudio
    | MessageContentVideo
    | MessageContentFile
    | MessageContentToolResult
    | MessageContentCodeExecution
    | MessageContentCitation;

/**
 * 消息内容
 */
export type MessageContent = string | MessageContentPart[];

// ============================================
// 聊天消息 - 增强版
// ============================================

/**
 * 聊天消息
 */
export interface ChatMessage {
    role: Role;
    content: MessageContent;

    /** 名称（多 Agent 场景） */
    name?: string;

    /** 工具调用 ID（tool 角色必填） */
    tool_call_id?: string;

    /** 音频配置 (assistant 消息) */
    audio?: {
        id: string;
        /** 过期时间戳 */
        expires_at?: number;
        /** 转录文本 */
        transcript?: string;
    };

    /** 附件列表 (便捷字段) */
    attachments?: Attachment[];

    /** 缓存控制 */
    cache_control?: { type: 'ephemeral' };
}

/**
 * 附件定义 (便捷接口)
 */
export interface Attachment {
    /** 附件类型 */
    type: 'image' | 'audio' | 'video' | 'file';
    /** 来源 */
    source: string | File | Blob | ArrayBuffer;
    /** 文件名 */
    filename?: string;
    /** MIME 类型 */
    mimeType?: string;
    /** 额外选项 */
    options?: {
        /** 图片细节级别 */
        detail?: 'auto' | 'low' | 'high';
        /** 音频格式 */
        format?: string;
    };
}

// ============================================
// 工具定义 - 增强版
// ============================================

/**
 * 工具调用
 */
export interface ToolCall {
    id: string;
    type: 'function' | 'computer_20241022' | 'bash_20241022' | 'text_editor_20241022' | 'mcp';
    function?: {
        name: string;
        arguments: string;
    };
    /** Computer Use 动作 */
    computer_use?: ComputerUseAction;
    /** MCP 工具调用 */
    mcp?: MCPToolCall;
}

/**
 * 工具定义 - 增强版
 */
export interface ToolDefinition {
    type: 'function' | 'computer_20241022' | 'bash_20241022' | 'text_editor_20241022' | 'mcp';
    function?: {
        name: string;
        description: string;
        parameters: Record<string, any>;
        /** 严格模式 (OpenAI Structured Output) */
        strict?: boolean;
    };
    /** Computer Use 配置 */
    computer_use?: {
        display_width: number;
        display_height: number;
        display_number?: number;
    };
    /** MCP 服务器配置 */
    mcp?: {
        server_name: string;
        tool_name: string;
    };
}

/**
 * Computer Use 动作 (Anthropic)
 */
export interface ComputerUseAction {
    action: 'key' | 'type' | 'mouse_move' | 'left_click' | 'right_click' |
    'middle_click' | 'double_click' | 'screenshot' | 'cursor_position' | 'scroll';
    coordinate?: [number, number];
    text?: string;
    scroll_direction?: 'up' | 'down' | 'left' | 'right';
    scroll_amount?: number;
}

/**
 * MCP 工具调用
 */
export interface MCPToolCall {
    server_name: string;
    tool_name: string;
    arguments: Record<string, any>;
}
