// @file llm-engine/core/types/session.ts

import { NodeStatus } from '@itookit/llmdriver';

/**
 * 会话运行状态
 */
export type SessionStatus = 
    | 'idle'        // 空闲
    | 'queued'      // 排队中
    | 'running'     // 正在生成
    | 'completed'   // 完成
    | 'failed'      // 报错
    | 'aborted'     // 用户中止
    | 'interrupted';// 异常中断（如页面刷新）

/**
 * 内存快照（用于解决 UI 重连时的流式断层）
 */
export interface SessionSnapshot {
    nodeId: string;       // 当前正在生成的节点 ID
    content: string;      // 当前已生成的文本
    thought: string;      // 当前已生成的思考过程
    status: NodeStatus;   // 节点状态
}

/**
 * 会话运行时信息
 */
export interface SessionRuntime {
    /** 会话唯一标识（对应 .chat 文件的 sessionId） */
    sessionId: string;
    
    /** VFS 节点 ID */
    nodeId: string;
    
    /** 当前状态 */
    status: SessionStatus;
    
    /** 当前运行的任务 ID（如果正在执行） */
    currentTaskId?: string;
    
    /** 最后活跃时间 */
    lastActiveTime: number;
    
    /** 未读消息数（后台完成时累加） */
    unreadCount: number;
    
    /** 错误信息（如果 status === 'failed'） */
    error?: Error;
    
    /** 进度信息（可选） */
    progress?: {
        stage: string;
        percent?: number;
    };
}

/**
 * 执行任务
 */
export interface ExecutionTask {
    id: string;
    sessionId: string;
    nodeId: string;
    input: {
        text: string;
        files: File[];
        executorId: string;
    };
    options: {
        skipUserMessage?: boolean;
        parentUserNodeId?: string;
    };
    priority: number;
    createdAt: number;
    abortController: AbortController;
}

/**
 * 会话事件（扩展原有 OrchestratorEvent）
 */
export type SessionRegistryEvent = 
    | { type: 'session_registered'; payload: { sessionId: string } }
    | { type: 'session_unregistered'; payload: { sessionId: string } }
    | { type: 'session_status_changed'; payload: { sessionId: string; status: SessionStatus; prevStatus: SessionStatus } }
    | { type: 'session_unread_updated'; payload: { sessionId: string; count: number } }
    | { type: 'session_error'; payload: { sessionId: string; error: Error } }
    | { type: 'pool_status_changed'; payload: { running: number; queued: number; maxConcurrent: number } };
