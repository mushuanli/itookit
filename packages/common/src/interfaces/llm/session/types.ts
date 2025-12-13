// @file common/interfaces/llm/session/types.ts

/**
 * 对应 {uuid}.chat 清单文件
 */
export interface ChatManifest {
    version: "1.0";
    id: string;              // Session UUID
    title: string;
    // ✨ [新增] 冗余存储摘要，用于列表显示和快速搜索
    summary?: string; 
    created_at: string;      // ISO Date
    updated_at: string;      // ISO Date
    
    // 全局 LLM 设置
    settings: {
        model: string;
        temperature: number;
        system_prompt?: string;
        [key: string]: any;
    };

    // 分支管理: branchName -> leafNodeId
    branches: Record<string, string>;
    
    // 当前上下文指针
    current_branch: string;
    current_head: string;    // 指向最新的 Message Node ID
    
    root_id: string;         // 指向 System Prompt 节点
}

/**
 * 基础节点属性
 */
interface BaseNode {
    id: string;
    created_at: string;
    parent_id: string | null;
    children_ids: string[];
    status: "active" | "deleted";
    meta?: {
        model?: string;
        tokens?: number;
        finish_reason?: string;
        [key: string]: any;
    };
}

/**
 * 普通对话消息节点
 */
export interface MessageNode extends BaseNode {
    type: "message";
    role: "system" | "user" | "assistant";
    content: string;
}

/**
 * 工具调用节点 (Assistant 发起)
 */
export interface ToolCallNode extends BaseNode {
    type: "tool_call";
    role: "assistant";
    // 兼容 OpenAI ToolCall 结构
    tool_call_id: string; 
    name: string;
    arguments: string; // JSON String
    content?: string;  // 通常为空，或者是思考过程
}

/**
 * 工具结果节点 (Tool 反馈)
 */
export interface ToolResultNode extends BaseNode {
    type: "tool_result";
    role: "tool";
    tool_call_id: string; // 关联到上面的 tool_call_id
    content: string;      // 执行结果
}

/**
 * 对应 .{uuid}/.{node_id}.yaml 消息节点文件
 * 使用 Discriminated Unions 增强类型安全
 */
export type ChatNode = MessageNode | ToolCallNode | ToolResultNode;

/**
 * 简单的 YAML 工具接口
 */
export interface IYamlParser {
    parse<T>(text: string): T;
    stringify(obj: any): string;
}


export interface MCPServer {
    id: string;
    name: string;
    icon?: string;
    description?: string;
    transport: 'stdio' | 'http' | 'sse';
    command?: string;
    args?: string;
    cwd?: string;
    endpoint?: string;
    apiKey?: string;
    headers?: Record<string, string>;
    autoConnect?: boolean;
    timeout?: number;
    status?: 'idle' | 'connected' | 'error';
    tools?: any[];
    resources?: any[];
}
