// @file llm-ui/types.ts

import { ExecutionContext, NodeStatus, ChatNode } from '@itookit/common';

/**
 * UI 层的执行节点（用于渲染）
 * 与 ChatNode（持久化层）分离，但可以互相转换
 */
export interface ExecutionNode {
    id: string;
    parentId?: string;
    type: 'agent' | 'tool' | 'thought' | 'router';
    name: string;
    icon?: string;
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
        
        // [修改] 供 UI 显示的元数据
        metaInfo?: {
            provider?: string;       
            connectionName?: string; 
            model?: string;          
            systemPrompt?: string;   
            
            // [新增] 布局提示，用于 UI 决定如何渲染子节点容器
            // 'parallel' -> Grid 布局
            // 'serial' -> 垂直列表 (默认)
            layout?: 'parallel' | 'serial';
            
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
}

/**
 * 扩展标准执行上下文，注入 UI 流式回调能力和节点生命周期管理
 */
export interface StreamingContext extends ExecutionContext {
    // 当前会话 ID，用于持久化
    sessionId?: string;
    
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
    | { type: 'session_start'; payload: SessionGroup }
    | { type: 'node_start'; payload: { parentId?: string; node: ExecutionNode } }
    | { type: 'node_update'; payload: { nodeId: string; chunk?: string; field?: 'thought' | 'output'; metaInfo?: any } }
    | { type: 'node_status'; payload: { nodeId: string; status: NodeStatus; result?: any } }
    | { type: 'request_input'; payload: { nodeId: string; schema: any } }
    | { type: 'finished'; payload: { sessionId: string } };