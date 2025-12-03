// @file common/interfaces/llm/session/types.ts

/**
 * 对应 {uuid}.chat 清单文件
 */
export interface ChatManifest {
    version: "1.0";
    id: string;              // Session UUID
    title: string;
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
 * 对应 .{uuid}/.{node_id}.yaml 消息节点文件
 */
export interface ChatNode {
    id: string;
    type: "message" | "tool_call" | "tool_result";
    role: "system" | "user" | "assistant" | "tool";
    created_at: string;
    
    // DAG 链接
    parent_id: string | null;
    children_ids: string[];  // 可选，用于加速向下遍历
    
    // 内容
    content: string;
    
    // 扩展信息
    meta?: {
        model?: string;
        tokens?: number;
        finish_reason?: string;
        [key: string]: any;
    };
    
    // 状态
    status: "active" | "deleted";
}

/**
 * 简单的 YAML 工具接口 (假设外部已提供或使用 js-yaml)
 */
export interface IYamlParser {
    parse<T>(text: string): T;
    stringify(obj: any): string;
}
