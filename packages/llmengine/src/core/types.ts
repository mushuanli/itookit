// @file: llm-engine/core/types.ts

import { ExecutionContext, NodeStatus, ChatNode } from '@itookit/common';
export * from './errors';

/**
 * UI 层的执行节点（用于渲染）
 * 与 ChatNode（持久化层）分离，但可以互相转换
 */
export interface ExecutionNode {
    id: string;
    parentId?: string;
    type: 'agent' | 'tool' | 'thought' | 'router';
    name: string;
    status: NodeStatus;
    startTime: number;
    endTime?: number;
    
    // 动态数据
    data: {
        input?: any;
        thought?: string; // CoT 推理内容
        output?: string;  // 最终输出内容
        toolCall?: { name: string; args: any; result?: any };
        artifacts?: any[];
        
        // [修改] 语义化元数据，替代 UI 布局属性
        metaInfo?: {
            provider?: string;       
            connectionName?: string; 
            model?: string;          
            systemPrompt?: string;   
            
            // [修改] 语义化执行模式
            // 'concurrent' -> 并行执行 (UI 可据此渲染 Grid)
            // 'sequential' -> 串行执行 (UI 可据此渲染 List)
            executionMode?: 'concurrent' | 'sequential';
            
            // 原始 Agent ID，UI 可据此查找图标
            agentId?: string;
            
            // 批处理大小（针对并发模式）
            batchSize?: number;

            [key: string]: any;
        };
    };
    
    // 子节点（用于并行任务或嵌套编排）
    children?: ExecutionNode[];
}

/**
 * UI 会话组（对应一轮对话）
 */
export interface SessionGroup {
    id: string;
    timestamp: number;
    role: 'user' | 'assistant';
    content?: string; // 用户输入的纯文本
    files?: Array<{ name: string; type: string }>; // 附件
    
    // 系统的执行树根节点（如果是 assistant 角色）
    executionRoot?: ExecutionNode;
    
    // 关联到持久化节点的 ID
    persistedNodeId?: string;
    
    // ✨ [新增] 分支导航支持
    siblingIndex?: number;      // 当前在兄弟节点中的索引
    siblingCount?: number;      // 兄弟节点总数
    
    // ✨ [新增] 关联的用户消息 ID（对于 assistant）
    parentUserSessionId?: string;
}

/**
 * 扩展标准执行上下文，注入 UI 流式回调能力和节点生命周期管理
 */
export interface StreamingContext extends ExecutionContext {
    // 当前会话 ID，用于持久化
    sessionId?: string;
    
    // ✨ [修复 3.1] 添加 AbortSignal 支持
    signal?: AbortSignal;
    
    callbacks?: {
        // 增加 nodeId 参数，支持定向输出
        onThinking?: (delta: string, nodeId?: string) => void;
        onOutput?: (delta: string, nodeId?: string) => void;
        
        // 允许 Executor 动态创建子节点 UI
        onNodeStart?: (node: ExecutionNode) => void;
        
        // 允许 Executor 更新节点状态
        onNodeStatus?: (nodeId: string, status: NodeStatus) => void;
        
        // 允许更新元数据 (如设置布局模式)
        onNodeMetaUpdate?: (nodeId: string, meta: any) => void;
    };
}
// 事件总线定义
export type OrchestratorEvent = 
    // 会话事件
    | { type: 'session_start'; payload: SessionGroup }
    | { type: 'session_cleared'; payload: Record<string, never> }
    
    // 节点事件
    | { type: 'node_start'; payload: { parentId?: string; node: ExecutionNode } }
    | { type: 'node_update'; payload: { nodeId: string; chunk?: string; field?: 'thought' | 'output'; metaInfo?: any } }
    | { type: 'node_status'; payload: { nodeId: string; status: NodeStatus; result?: any } }
    
    // 交互事件
    | { type: 'request_input'; payload: { nodeId: string; schema: any } }
    | { type: 'finished'; payload: { sessionId: string } }
    | { type: 'error'; payload: { message: string; error?: Error } }
    
    // ✨ [新增] 编辑/删除/重试事件
    | { type: 'messages_deleted'; payload: { deletedIds: string[] } }
    | { type: 'message_edited'; payload: { sessionId: string; newContent: string } }
    | { type: 'retry_started'; payload: { originalId: string; newId: string } }
    | { type: 'sibling_switch'; payload: { sessionId: string; newIndex: number; total: number } };
