// @file llm-ui/types.ts

export type NodeStatus = 'pending' | 'running' | 'success' | 'failed' | 'waiting_user';

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
        
        // [新增] 供 UI 显示的元数据
        metaInfo?: {
            provider?: string;       // e.g., 'deepseek', 'openai'
            connectionName?: string; // e.g., 'My DeepSeek'
            model?: string;          // e.g., 'deepseek-chat'
            systemPrompt?: string;   // e.g., 'You are a helpful...'
            [key: string]: any;
        };
    };
    
    // 子节点（用于并行任务或嵌套编排）
    children?: ExecutionNode[];
}

export interface SessionGroup {
    id: string;
    timestamp: number;
    role: 'user' | 'assistant';
    content?: string; // 用户输入的纯文本
    files?: Array<{ name: string; type: string }>; // 附件
    
    // 系统的执行树根节点（如果是 assistant 角色）
    executionRoot?: ExecutionNode;
}

// 事件总线定义
export type OrchestratorEvent = 
    | { type: 'session_start'; payload: SessionGroup }
    | { type: 'node_start'; payload: { parentId?: string; node: ExecutionNode } }
    | { type: 'node_update'; payload: { nodeId: string; chunk: string; field: 'thought' | 'output' } }
    | { type: 'node_status'; payload: { nodeId: string; status: NodeStatus; result?: any } }
    | { type: 'request_input'; payload: { nodeId: string; schema: any } }
    | { type: 'finished'; payload: { sessionId: string } };