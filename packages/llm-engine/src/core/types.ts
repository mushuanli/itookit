// @file: llm-engine/src/core/types.ts

import { NodeStatus } from '@itookit/llm-kernel';

/**
 * 聊天附件定义
 */
export interface ChatFile {
    name: string;
    type: string;
    /** 
     * 存储路径 (相对路径 ./xxx 或 协议路径 @asset/xxx) 
     */
    path?: string;
    size?: number;
    /** 
     * 运行时使用的原始文件对象 (不持久化)
     * 用于 Kernel 执行时读取内容
     */
    fileRef?: File | Blob;
}

/**
 * ✅ 新增：分支信息
 */
export interface BranchInfo {
    siblingIndex: number;
    siblingCount: number;
    parentAssistantId?: string;
}


/**
 * ✅ 新增：查询覆盖参数
 */
export interface ExecutionOverrides {
    /** 覆盖模型 ID */
    modelId?: string;
    /** 历史消息数量限制，-1 表示不限制 */
    historyLength?: number;
    /** 温度参数 */
    temperature?: number;
}

/**
 * 执行节点（UI 层表示）
 */
export interface ExecutionNode {
    /** 节点 ID */
    id: string;

    /** 父节点 ID */
    parentId?: string;

    /** 执行器 ID */
    executorId: string;

    /** 执行器类型 */
    executorType: 'agent' | 'tool' | 'http' | 'script' | 'composite';

    /** 显示名称 */
    name: string;

    /** 节点状态 */
    status: NodeStatus;

    /** 开始时间 */
    startTime: number;

    /** 结束时间 */
    endTime?: number;

    /** 节点数据 */
    data: {
        /** 输入 */
        input?: unknown;

        /** 思考过程 */
        thought?: string;

        /** 输出内容 */
        output?: string;

        /** 工具调用 */
        toolCall?: {
            name: string;
            args: any;
            result?: any;
        };

        /** 元数据 */
        metaInfo?: Record<string, any>;

        /** ✅ 新增：错误信息 */
        error?: string;
    };

    /** 子节点 */
    children?: ExecutionNode[];
}

/**
 * 会话组（一轮对话）
 */
export interface SessionGroup {
    /** 会话组 ID */
    id: string;

    /** 时间戳 */
    timestamp: number;

    /** 角色 */
    role: 'user' | 'assistant';

    /** 用户输入内容 */
    content?: string;

    /** ✅ [修改] 使用 ChatFile 类型 */
    files?: ChatFile[];

    /** 执行树根节点（assistant 角色） */
    executionRoot?: ExecutionNode;

    /** 持久化节点 ID */
    persistedNodeId?: string;

    /** 分支导航 */
    siblingIndex?: number;
    siblingCount?: number;

    /** 关联的用户消息 ID */
    parentUserSessionId?: string;
}

/**
 * UI 事件类型
 */
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
    // ✅ 修复：扩展 error payload 以支持 code
    | { type: 'error'; payload: { message: string; error?: Error; code?: string | number } }

    // 编辑/删除事件
    | { type: 'messages_deleted'; payload: { deletedIds: string[] } }
    | { type: 'message_edited'; payload: { sessionId: string; newContent: string } }
    // ✅ 修复：扩展 payload
    | {
        type: 'retry_started';
        payload: {
            originalId: string;
            newId: string;
            siblingIndex?: number;
            siblingCount?: number;
        }
    }
    | { type: 'sibling_switch'; payload: { sessionId: string; newIndex: number; total: number } };

/**
 * 会话运行状态
 */
export type SessionStatus =
    | 'idle'
    | 'queued'
    | 'running'
    | 'completed'
    | 'failed'
    | 'aborted';

/**
 * 会话运行时信息
 */
export interface SessionRuntime {
    /** 会话 ID */
    sessionId: string;

    /** VFS 节点 ID */
    nodeId: string;

    /** 当前状态 */
    status: SessionStatus;

    /** 当前任务 ID */
    currentTaskId?: string;

    /** 最后活跃时间 */
    lastActiveTime: number;

    /** 未读消息数 */
    unreadCount: number;

    /** 错误信息 */
    error?: Error;
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
        /** ✅ [修改] 传递 ChatFile 数组 */
        files: ChatFile[];
        executorId: string;
        overrides?: ExecutionOverrides;
    };
    // ✅ 修复：添加 branchInfo
    options: {
        skipUserMessage?: boolean;
        parentUserNodeId?: string;
        branchInfo?: BranchInfo;
    };
    priority: number;
    createdAt: number;
    abortController: AbortController;
}

/**
 * 注册表事件
 */
export type RegistryEvent =
    | { type: 'session_registered'; payload: { sessionId: string } }
    | { type: 'session_unregistered'; payload: { sessionId: string } }
    | { type: 'session_status_changed'; payload: { sessionId: string; status: SessionStatus; prevStatus?: SessionStatus } }
    | { type: 'session_unread_updated'; payload: { sessionId: string; count: number } }
    | { type: 'pool_status_changed'; payload: { running: number; queued: number; maxConcurrent: number } };
