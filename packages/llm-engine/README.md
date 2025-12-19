# @itookit/llm-engine

LLM 会话引擎 - UI 适配层

## 概述

`@itookit/llm-engine` 是 LLM 应用架构的顶层模块，负责会话管理、UI 事件适配、持久化集成和多会话并发控制。它作为 `@itookit/llm-kernel`（执行引擎）和 UI 层之间的桥梁，提供了完整的会话生命周期管理能力。

```
┌─────────────────────────────────────────────────────────────┐
│                        UI Layer                             │
│              (React/Vue Components, Editors)                │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    @itookit/llm-engine                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ SessionMgr  │  │  Registry   │  │    Adapters         │  │
│  │(View Proxy) │  │ (Pool/Queue)│  │ (Kernel, UI, Persist)│ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    @itookit/llm-kernel                      │
│                 (Executors, Orchestrators)                  │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    @itookit/llm-driver                      │
│                    (LLM API Client)                         │
└─────────────────────────────────────────────────────────────┘
```

## 特性

- ✅ **多会话管理** - 支持多个会话同时运行，智能队列调度
- ✅ **事件驱动** - 完全解耦的事件系统，支持流式更新
- ✅ **会话恢复** - 页面刷新后自动恢复未完成的任务
- ✅ **持久化集成** - 与 VFS 无缝集成，自动保存会话历史
- ✅ **并发控制** - 可配置的并发池，防止资源过载
- ✅ **后台执行** - 支持会话在后台继续运行
- ✅ **类型安全** - 完整的 TypeScript 类型定义

## 安装

```bash
pnpm add @itookit/llm-engine
```

## 快速开始

### 1. 初始化

```typescript
import { VFSCore } from '@itookit/vfs-core';
import { 
    initializeLLMEngine, 
    VFSAgentService, 
    LLMSessionEngine 
} from '@itookit/llm-engine';

async function init() {
    // 初始化 VFS
    const vfs = VFSCore.getInstance();
    await vfs.init();
    
    // 创建服务
    const agentService = new VFSAgentService(vfs);
    const sessionEngine = new LLMSessionEngine(vfs);
    
    // 初始化 Engine
    const { registry } = await initializeLLMEngine({
        agentService,
        sessionEngine,
        maxConcurrent: 3  // 最大并发数
    });
    
    return registry;
}
```

### 2. 在编辑器中使用 SessionManager

```typescript
import { SessionManager } from '@itookit/llm-engine';

class ChatEditor {
    private manager = new SessionManager();
    
    async open(nodeId: string, sessionId: string) {
        // 绑定会话
        await this.manager.bindSession(nodeId, sessionId);
        
        // 订阅事件
        this.manager.onEvent((event) => {
            switch (event.type) {
                case 'session_start':
                    this.addMessage(event.payload);
                    break;
                case 'node_update':
                    this.updateContent(event.payload);
                    break;
                case 'finished':
                    this.setLoading(false);
                    break;
                case 'error':
                    this.showError(event.payload.message);
                    break;
            }
        });
        
        // 加载历史消息
        const messages = this.manager.getSessions();
        messages.forEach(msg => this.addMessage(msg));
    }
    
    async send(text: string, files: File[] = []) {
        await this.manager.runUserQuery(text, files, 'default');
    }
    
    stop() {
        this.manager.abort();
    }
    
    close() {
        this.manager.destroy();
    }
}
```

### 3. 监听全局状态

```typescript
import { getSessionRegistry } from '@itookit/llm-engine';

const registry = getSessionRegistry();

// 监听全局事件
registry.onGlobalEvent((event) => {
    switch (event.type) {
        case 'session_status_changed':
            updateStatusIndicator(event.payload.sessionId, event.payload.status);
            break;
        case 'pool_status_changed':
            updatePoolStatus(event.payload);
            break;
        case 'session_unread_updated':
            updateUnreadBadge(event.payload.sessionId, event.payload.count);
            break;
    }
});
```

## 核心概念

### SessionManager vs SessionRegistry

| 组件 | 职责 | 作用域 |
|------|------|--------|
| **SessionManager** | 单会话视图代理 | 一个 Editor 对应一个实例 |
| **SessionRegistry** | 全局会话注册表 | 整个应用共享一个单例 |

```typescript
// SessionManager - 每个编辑器创建一个
const manager = new SessionManager();
await manager.bindSession(nodeId, sessionId);

// SessionRegistry - 全局单例
const registry = getSessionRegistry();
const allSessions = registry.getAllSessions();
```

### 会话状态

```typescript
type SessionStatus = 
    | 'idle'       // 空闲
    | 'queued'     // 排队中
    | 'running'    // 正在生成
    | 'completed'  // 完成
    | 'failed'     // 失败
    | 'aborted';   // 用户中止
```

### 事件类型

```typescript
// UI 事件
type OrchestratorEvent =
    | { type: 'session_start'; payload: SessionGroup }
    | { type: 'node_start'; payload: { node: ExecutionNode } }
    | { type: 'node_update'; payload: { nodeId: string; chunk: string; field: 'thought' | 'output' } }
    | { type: 'node_status'; payload: { nodeId: string; status: NodeStatus } }
    | { type: 'finished'; payload: { sessionId: string } }
    | { type: 'error'; payload: { message: string; error?: Error } }
    | { type: 'messages_deleted'; payload: { deletedIds: string[] } }
    | { type: 'message_edited'; payload: { sessionId: string; newContent: string } };

// 全局事件
type RegistryEvent =
    | { type: 'session_registered'; payload: { sessionId: string } }
    | { type: 'session_unregistered'; payload: { sessionId: string } }
    | { type: 'session_status_changed'; payload: { sessionId: string; status: SessionStatus } }
    | { type: 'session_unread_updated'; payload: { sessionId: string; count: number } }
    | { type: 'pool_status_changed'; payload: { running: number; queued: number; maxConcurrent: number } };
```

## API 参考

### SessionManager

```typescript
class SessionManager {
    // 会话绑定
    bindSession(nodeId: string, sessionId: string): Promise<void>
    unbindSession(): void
    
    // 状态查询
    getSessions(): SessionGroup[]
    getCurrentSessionId(): string | null
    getStatus(): SessionStatus | 'unbound'
    isGenerating(): boolean
    
    // 执行控制
    runUserQuery(text: string, files: File[], executorId: string): Promise<void>
    abort(): void
    
    // 消息操作
    deleteMessage(id: string): Promise<void>
    editMessage(id: string, content: string, autoRerun?: boolean): Promise<void>
    retryGeneration(assistantId: string, options?: RetryOptions): Promise<void>
    
    // 权限检查
    canDeleteMessage(id: string): { allowed: boolean; reason?: string }
    canRetry(id: string): { allowed: boolean; reason?: string }
    canEdit(id: string): { allowed: boolean; reason?: string }
    
    // 事件订阅
    onEvent(handler: (event: OrchestratorEvent) => void): () => void
    
    // 导出
    exportToMarkdown(): string
    
    // 生命周期
    destroy(): void
}
```

### SessionRegistry

```typescript
class SessionRegistry {
    // 单例
    static getInstance(): SessionRegistry
    
    // 初始化
    initialize(agentService: IAgentService, sessionEngine: ISessionEngine, options?: { maxConcurrent?: number }): void
    
    // 会话管理
    registerSession(nodeId: string, sessionId: string): Promise<SessionRuntime>
    unregisterSession(sessionId: string, options?: { force?: boolean; keepInBackground?: boolean }): Promise<void>
    setActiveSession(sessionId: string | null): void
    getActiveSessionId(): string | null
    
    // 任务执行
    submitTask(sessionId: string, input: { text: string; files: File[]; executorId: string }, options?: { priority?: number }): Promise<string>
    abortSession(sessionId: string): Promise<void>
    
    // 查询
    getSessionRuntime(sessionId: string): SessionRuntime | undefined
    getSessionMessages(sessionId: string): SessionGroup[]
    getAllSessions(): SessionRuntime[]
    getRunningSessions(): SessionRuntime[]
    getFailedSessions(): SessionRuntime[]
    getUnreadSessions(): SessionRuntime[]
    getPoolStatus(): { running: number; queued: number; maxConcurrent: number; available: number }
    
    // 消息操作
    deleteMessage(sessionId: string, messageId: string): Promise<void>
    editMessage(sessionId: string, messageId: string, content: string, autoRerun?: boolean): Promise<void>
    retryGeneration(sessionId: string, assistantId: string, options?: { agentId?: string }): Promise<void>
    
    // 事件
    onGlobalEvent(handler: (event: RegistryEvent) => void): () => void
    onSessionEvent(sessionId: string, handler: (event: OrchestratorEvent) => void): () => void
    
    // 配置
    setMaxConcurrent(value: number): void
    
    // 清理
    startAutoCleanup(intervalMs?: number): () => void
    cleanupIdleSessions(maxIdleTime?: number): number
    getMemoryEstimate(): { sessions: number; messages: number; estimatedMB: number }
    
    // 导出
    exportToMarkdown(sessionId: string): string
    
    // 销毁
    destroy(): Promise<void>
}
```

### SessionRecovery

```typescript
class SessionRecovery {
    constructor(registry?: SessionRegistry)
    
    // 状态检查
    hasRecoverableState(): boolean
    getRecoverableSessions(): PersistedSessionState[]
    
    // 恢复操作
    recoverSessions(): Promise<{ recovered: string[]; failed: string[] }>
    clearRecoveryState(): void
    
    // UI
    showRecoveryDialog(): Promise<boolean>
    
    // 手动保存
    saveImmediately(): void
}
```

## 高级用法

### 会话恢复

```typescript
import { SessionRecovery, getSessionRegistry } from '@itookit/llm-engine';

const registry = getSessionRegistry();
const recovery = new SessionRecovery(registry);

// 在应用启动时检查
if (recovery.hasRecoverableState()) {
    // 方式 1: 显示对话框
    const recovered = await recovery.showRecoveryDialog();
    
    // 方式 2: 静默恢复
    const { recovered, failed } = await recovery.recoverSessions();
    console.log(`Recovered ${recovered.length} sessions`);
}
```

### 并发控制

```typescript
const registry = getSessionRegistry();

// 设置最大并发数
registry.setMaxConcurrent(5);

// 查看池状态
const status = registry.getPoolStatus();
console.log(`Running: ${status.running}/${status.maxConcurrent}`);
console.log(`Queued: ${status.queued}`);
console.log(`Available: ${status.available}`);
```

### 后台执行

```typescript
// 关闭编辑器时保持会话运行
await registry.unregisterSession(sessionId, { 
    keepInBackground: true 
});

// 监听后台完成
registry.onGlobalEvent((event) => {
    if (event.type === 'session_status_changed' && event.payload.status === 'completed') {
        showNotification(`Session ${event.payload.sessionId} completed`);
    }
});

// 查看未读消息
const unreadSessions = registry.getUnreadSessions();
```

### 自动清理

```typescript
// 启动自动清理（每 5 分钟）
const stopCleanup = registry.startAutoCleanup(5 * 60 * 1000);

// 手动清理（清理 30 分钟无活动的会话）
const cleaned = registry.cleanupIdleSessions(30 * 60 * 1000);
console.log(`Cleaned ${cleaned} idle sessions`);

// 查看内存使用
const memory = registry.getMemoryEstimate();
console.log(`Sessions: ${memory.sessions}, Messages: ${memory.messages}, ~${memory.estimatedMB}MB`);

// 停止自动清理
stopCleanup();
```

### 自定义 Agent 服务

```typescript
import { IAgentService, AgentDefinition } from '@itookit/llm-engine';

class CustomAgentService implements IAgentService {
    async init() { /* ... */ }
    
    async getAgents(): Promise<AgentDefinition[]> {
        return fetch('/api/agents').then(r => r.json());
    }
    
    async getAgentConfig(agentId: string) {
        return fetch(`/api/agents/${agentId}`).then(r => r.json());
    }
    
    async getConnections() {
        return fetch('/api/connections').then(r => r.json());
    }

    async getConnection(id: string) {
        return fetch(`/api/connections/${id}`).then(r => r.json());
    }
    
    async saveConnection(conn: LLMConnection) {
        await fetch('/api/connections', {
            method: 'POST',
            body: JSON.stringify(conn)
        });
    }
    
    async deleteConnection(id: string) {
        await fetch(`/api/connections/${id}`, { method: 'DELETE' });
    }
    
    async saveAgent(agent: AgentDefinition) {
        await fetch('/api/agents', {
            method: 'POST',
            body: JSON.stringify(agent)
        });
    }
    
    async deleteAgent(id: string) {
        await fetch(`/api/agents/${id}`, { method: 'DELETE' });
    }
    
    async getMCPServers() {
        return fetch('/api/mcp-servers').then(r => r.json());
    }
    
    async saveMCPServer(server: MCPServer) {
        await fetch('/api/mcp-servers', {
            method: 'POST',
            body: JSON.stringify(server)
        });
    }
    
    async deleteMCPServer(id: string) {
        await fetch(`/api/mcp-servers/${id}`, { method: 'DELETE' });
    }
    
    onChange(callback: () => void) {
        // 实现变更监听（如 WebSocket）
        const ws = new WebSocket('/api/ws');
        ws.onmessage = () => callback();
        return () => ws.close();
    }
}

// 使用自定义服务
const agentService = new CustomAgentService();
await initializeLLMEngine({
    agentService,
    sessionEngine,
    maxConcurrent: 3
});
```

## React 集成

### useSessionManager Hook

```typescript
// @file: hooks/useSessionManager.ts

import { useState, useEffect, useCallback, useRef } from 'react';
import { 
    SessionManager, 
    SessionGroup, 
    OrchestratorEvent,
    SessionStatus 
} from '@itookit/llm-engine';

export interface UseSessionManagerOptions {
    nodeId: string;
    sessionId: string;
    onError?: (error: Error) => void;
}

export function useSessionManager(options: UseSessionManagerOptions) {
    const { nodeId, sessionId, onError } = options;
    
    const managerRef = useRef<SessionManager | null>(null);
    const [messages, setMessages] = useState<SessionGroup[]>([]);
    const [status, setStatus] = useState<SessionStatus | 'unbound'>('unbound');
    const [isGenerating, setIsGenerating] = useState(false);
    
    // 初始化
    useEffect(() => {
        const manager = new SessionManager();
        managerRef.current = manager;
        
        async function init() {
            try {
                await manager.bindSession(nodeId, sessionId);
                setMessages(manager.getSessions());
                setStatus(manager.getStatus());
                
                // 订阅事件
                manager.onEvent((event: OrchestratorEvent) => {
                    switch (event.type) {
                        case 'session_start':
                            setMessages(prev => [...prev, event.payload]);
                            break;
                            
                        case 'node_update':
                            setMessages(prev => {
                                const updated = [...prev];
                                const last = updated[updated.length - 1];
                                if (last?.executionRoot?.id === event.payload.nodeId) {
                                    const field = event.payload.field || 'output';
                                    last.executionRoot.data[field] = 
                                        (last.executionRoot.data[field] || '') + (event.payload.chunk || '');
                                }
                                return updated;
                            });
                            break;
                            
                        case 'node_status':
                            setMessages(prev => {
                                const updated = [...prev];
                                const last = updated[updated.length - 1];
                                if (last?.executionRoot?.id === event.payload.nodeId) {
                                    last.executionRoot.status = event.payload.status;
                                }
                                return updated;
                            });
                            break;
                            
                        case 'finished':
                            setIsGenerating(false);
                            setStatus('completed');
                            break;
                            
                        case 'error':
                            setIsGenerating(false);
                            setStatus('failed');
                            onError?.(event.payload.error || new Error(event.payload.message));
                            break;
                            
                        case 'messages_deleted':
                            setMessages(prev => 
                                prev.filter(m => !event.payload.deletedIds.includes(m.id))
                            );
                            break;
                    }
                });
                
            } catch (error) {
                onError?.(error as Error);
            }
        }
        
        init();
        
        return () => {
            manager.destroy();
            managerRef.current = null;
        };
    }, [nodeId, sessionId]);
    
    // 发送消息
    const sendMessage = useCallback(async (text: string, files: File[] = []) => {
        if (!managerRef.current || isGenerating) return;
        
        setIsGenerating(true);
        setStatus('running');
        
        try {
            await managerRef.current.runUserQuery(text, files, 'default');
        } catch (error) {
            setIsGenerating(false);
            setStatus('failed');
            onError?.(error as Error);
        }
    }, [isGenerating, onError]);
    
    // 中止
    const abort = useCallback(() => {
        managerRef.current?.abort();
        setIsGenerating(false);
        setStatus('aborted');
    }, []);
    
    // 删除消息
    const deleteMessage = useCallback(async (id: string) => {
        await managerRef.current?.deleteMessage(id);
    }, []);
    
    // 编辑消息
    const editMessage = useCallback(async (id: string, content: string, rerun = false) => {
        await managerRef.current?.editMessage(id, content, rerun);
    }, []);
    
    // 重试
    const retry = useCallback(async (assistantId: string) => {
        setIsGenerating(true);
        setStatus('running');
        await managerRef.current?.retryGeneration(assistantId);
    }, []);
    
    // 导出
    const exportMarkdown = useCallback(() => {
        return managerRef.current?.exportToMarkdown() || '';
    }, []);
    
    return {
        messages,
        status,
        isGenerating,
        sendMessage,
        abort,
        deleteMessage,
        editMessage,
        retry,
        exportMarkdown,
        canDelete: (id: string) => managerRef.current?.canDeleteMessage(id) ?? { allowed: false },
        canRetry: (id: string) => managerRef.current?.canRetry(id) ?? { allowed: false },
        canEdit: (id: string) => managerRef.current?.canEdit(id) ?? { allowed: false }
    };
}
```

### useSessionRegistry Hook

```typescript
// @file: hooks/useSessionRegistry.ts

import { useState, useEffect, useCallback } from 'react';
import { 
    getSessionRegistry, 
    SessionRuntime, 
    RegistryEvent 
} from '@itookit/llm-engine';

export function useSessionRegistry() {
    const registry = getSessionRegistry();
    
    const [sessions, setSessions] = useState<SessionRuntime[]>([]);
    const [poolStatus, setPoolStatus] = useState({
        running: 0,
        queued: 0,
        maxConcurrent: 3,
        available: 3
    });
    
    useEffect(() => {
        // 初始状态
        setSessions(registry.getAllSessions());
        setPoolStatus(registry.getPoolStatus());
        
        // 订阅事件
        const unsubscribe = registry.onGlobalEvent((event: RegistryEvent) => {
            switch (event.type) {
                case 'session_registered':
                case 'session_unregistered':
                case 'session_status_changed':
                case 'session_unread_updated':
                    setSessions(registry.getAllSessions());
                    break;
                    
                case 'pool_status_changed':
                    setPoolStatus(registry.getPoolStatus());
                    break;
            }
        });
        
        return unsubscribe;
    }, []);
    
    const abortSession = useCallback((sessionId: string) => {
        registry.abortSession(sessionId);
    }, []);
    
    const setMaxConcurrent = useCallback((value: number) => {
        registry.setMaxConcurrent(value);
        setPoolStatus(registry.getPoolStatus());
    }, []);
    
    return {
        sessions,
        poolStatus,
        runningSessions: sessions.filter(s => s.status === 'running'),
        failedSessions: sessions.filter(s => s.status === 'failed'),
        unreadSessions: sessions.filter(s => s.unreadCount > 0),
        abortSession,
        setMaxConcurrent,
        activeSessionId: registry.getActiveSessionId()
    };
}
```

### 使用示例

```tsx
// @file: components/ChatView.tsx

import React, { useState } from 'react';
import { useSessionManager } from '../hooks/useSessionManager';

interface ChatViewProps {
    nodeId: string;
    sessionId: string;
}

export function ChatView({ nodeId, sessionId }: ChatViewProps) {
    const [input, setInput] = useState('');
    
    const {
        messages,
        isGenerating,
        sendMessage,
        abort,
        deleteMessage,
        retry,
        canDelete,
        canRetry
    } = useSessionManager({
        nodeId,
        sessionId,
        onError: (error) => console.error('Chat error:', error)
    });
    
    const handleSend = async () => {
        if (!input.trim() || isGenerating) return;
        const text = input;
        setInput('');
        await sendMessage(text);
    };
    
    return (
        <div className="chat-view">
            {/* 消息列表 */}
            <div className="messages">
                {messages.map(msg => (
                    <div key={msg.id} className={`message ${msg.role}`}>
                        {msg.role === 'user' ? (
                            <div className="user-message">
                                <p>{msg.content}</p>
                                {canDelete(msg.id).allowed && (
                                    <button onClick={() => deleteMessage(msg.id)}>
                                        Delete
                                    </button>
                                )}
                            </div>
                        ) : (
                            <div className="assistant-message">
                                {msg.executionRoot?.data.thought && (
                                    <details className="thinking">
                                        <summary>Thinking...</summary>
                                        <pre>{msg.executionRoot.data.thought}</pre>
                                    </details>
                                )}
                                <div className="output">
                                    {msg.executionRoot?.data.output}
                                </div>
                                {canRetry(msg.id).allowed && (
                                    <button onClick={() => retry(msg.id)}>
                                        Retry
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                ))}
            </div>
            
            {/* 输入区域 */}
            <div className="input-area">
                <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                    placeholder="Type a message..."
                    disabled={isGenerating}
                />
                {isGenerating ? (
                    <button onClick={abort}>Stop</button>
                ) : (
                    <button onClick={handleSend}>Send</button>
                )}
            </div>
        </div>
    );
}
```

```tsx
// @file: components/SessionStatusBar.tsx

import React from 'react';
import { useSessionRegistry } from '../hooks/useSessionRegistry';

export function SessionStatusBar() {
    const {
        poolStatus,
        runningSessions,
        unreadSessions,
        abortSession
    } = useSessionRegistry();
    
    return (
        <div className="session-status-bar">
            <div className="pool-status">
                <span>
                    {poolStatus.running}/{poolStatus.maxConcurrent} running
                </span>
                <span>
                    {poolStatus.queued} queued
                </span>
            </div>
            
            {runningSessions.length > 0 && (
                <div className="running-sessions">
                    <h4>Running:</h4>
                    {runningSessions.map(session => (
                        <div key={session.sessionId} className="session-item">
                            <span>{session.sessionId.slice(0, 8)}...</span>
                            <button onClick={() => abortSession(session.sessionId)}>
                                Cancel
                            </button>
                        </div>
                    ))}
                </div>
            )}
            
            {unreadSessions.length > 0 && (
                <div className="unread-badge">
                    {unreadSessions.reduce((sum, s) => sum + s.unreadCount, 0)} unread
                </div>
            )}
        </div>
    );
}
```

## CLI / Worker 环境使用

`llm-engine` 设计为可在非 UI 环境运行：

```typescript
// @file: worker.ts

import { 
    initializeLLMEngine,
    getSessionRegistry,
    VFSAgentService,
    LLMSessionEngine
} from '@itookit/llm-engine';

async function runInWorker() {
    // 初始化（不需要 DOM）
    const { registry } = await initializeLLMEngine({
        agentService: new VFSAgentService(),
        sessionEngine: new LLMSessionEngine(),
        maxConcurrent: 5
    });
    
    // 监听任务
    registry.onGlobalEvent((event) => {
        if (event.type === 'session_status_changed') {
            console.log(`[Worker] Session ${event.payload.sessionId}: ${event.payload.status}`);
        }
    });
    
    // 执行任务
    const sessionId = 'worker-session-1';
    await registry.registerSession('node-1', sessionId);
    
    await registry.submitTask(sessionId, {
        text: 'Analyze this data...',
        files: [],
        executorId: 'data-analyst'
    });
    
    // 等待完成
    await new Promise(resolve => {
        registry.onSessionEvent(sessionId, (event) => {
            if (event.type === 'finished') resolve(undefined);
        });
    });
    
    console.log('[Worker] Task completed');
}

runInWorker();
```

## 错误处理

```typescript
import { EngineError, EngineErrorCode } from '@itookit/llm-engine';

try {
    await manager.runUserQuery(text, files, executorId);
} catch (error) {
    if (error instanceof EngineError) {
        switch (error.code) {
            case EngineErrorCode.SESSION_BUSY:
                showToast('Session is busy, please wait');
                break;
            case EngineErrorCode.QUOTA_EXCEEDED:
                showToast('Rate limit exceeded, retrying...');
                if (error.retryable) {
                    await sleep(5000);
                    await manager.runUserQuery(text, files, executorId);
                }
                break;
            case EngineErrorCode.CONTEXT_LIMIT:
                showToast('Conversation too long, please start a new chat');
                break;
            case EngineErrorCode.NETWORK_ERROR:
                showToast('Network error, please check your connection');
                break;
            case EngineErrorCode.ABORTED:
                // 用户主动取消，不需要提示
                break;
            default:
                showToast(`Error: ${error.message}`);
        }
    } else {
        showToast('An unexpected error occurred');
        console.error(error);
    }
}
```

### 错误码参考

| 错误码 | 说明 | 可重试 |
|--------|------|--------|
| `NETWORK_ERROR` | 网络连接失败 | ✅ |
| `TIMEOUT` | 请求超时 | ✅ |
| `SESSION_NOT_FOUND` | 会话不存在 | ❌ |
| `SESSION_BUSY` | 会话正在执行中 | ❌ |
| `SESSION_INVALID` | 会话状态无效 | ❌ |
| `EXECUTION_FAILED` | 执行失败 | ✅ |
| `EXECUTOR_NOT_FOUND` | 找不到执行器 | ❌ |
| `QUOTA_EXCEEDED` | 速率限制 | ✅ |
| `CONTEXT_LIMIT` | 上下文超限 | ❌ |
| `ABORTED` | 用户取消 | ❌ |
| `UNKNOWN` | 未知错误 | ✅ |

## 数据结构

### SessionGroup

```typescript
interface SessionGroup {
    /** 会话组 ID */
    id: string;
    
    /** 时间戳 */
    timestamp: number;
    
    /** 角色: 用户或助手 */
    role: 'user' | 'assistant';
    
    /** 用户输入内容（role='user' 时） */
    content?: string;
    
    /** 附件列表 */
    files?: Array<{ name: string; type: string }>;
    
    /** 执行树根节点（role='assistant' 时） */
    executionRoot?: ExecutionNode;
    
    /** 持久化节点 ID */
    persistedNodeId?: string;
    
    /** 分支索引（多分支时） */
    siblingIndex?: number;
    siblingCount?: number;
}
```

### ExecutionNode

```typescript
interface ExecutionNode {
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
    
    /** 状态 */
    status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled';
    
    /** 开始/结束时间 */
    startTime: number;
    endTime?: number;
    
    /** 节点数据 */
    data: {
        input?: unknown;
        thought?: string;    // 思考过程
        output?: string;     // 输出内容
        toolCall?: { name: string; args: any; result?: any };
        metaInfo?: Record<string, any>;
    };
    
    /** 子节点 */
    children?: ExecutionNode[];
}
```

### SessionRuntime

```typescript
interface SessionRuntime {
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
```

## 配置常量

```typescript
const ENGINE_DEFAULTS = {
    /** 最大并发任务数 */
    MAX_CONCURRENT: 3,
    
    /** 任务队列最大长度 */
    MAX_QUEUE_SIZE: 10,
    
    /** 会话空闲超时（30分钟） */
    SESSION_IDLE_TIMEOUT: 30 * 60 * 1000,
    
    /** 恢复状态最大保存时间（1小时） */
    RECOVERY_MAX_AGE: 60 * 60 * 1000,
    
    /** 持久化节流间隔 */
    PERSIST_THROTTLE: 500,
    
    /** 自动清理间隔（5分钟） */
    CLEANUP_INTERVAL: 5 * 60 * 1000
};
```

## 最佳实践

### 1. 及时销毁 SessionManager

```typescript
// ❌ 错误：忘记销毁
useEffect(() => {
    const manager = new SessionManager();
    manager.bindSession(nodeId, sessionId);
}, []);

// ✅ 正确：在 cleanup 中销毁
useEffect(() => {
    const manager = new SessionManager();
    manager.bindSession(nodeId, sessionId);
    
    return () => manager.destroy();
}, [nodeId, sessionId]);
```

### 2. 处理快速切换

```typescript
// SessionManager 内部已处理绑定版本控制
// 快速切换时，旧的 bindSession 会自动取消

async function switchSession(newSessionId: string) {
    // 不需要手动 unbind，bindSession 会自动处理
    await manager.bindSession(nodeId, newSessionId);
}
```

### 3. 后台任务通知

```typescript
// 监听后台完成的任务
registry.onGlobalEvent((event) => {
    if (event.type === 'session_status_changed' && 
        event.payload.status === 'completed' &&
        event.payload.sessionId !== registry.getActiveSessionId()) {
        
        // 显示系统通知
        if (Notification.permission === 'granted') {
            new Notification('AI Task Completed', {
                body: `Session ${event.payload.sessionId.slice(0, 8)} finished`
            });
        }
    }
});
```

### 4. 内存管理

```typescript
// 启动自动清理
const stopCleanup = registry.startAutoCleanup(5 * 60 * 1000);

// 定期检查内存
setInterval(() => {
    const memory = registry.getMemoryEstimate();
    if (memory.estimatedMB > 100) {
        console.warn('High memory usage, cleaning up...');
        registry.cleanupIdleSessions(10 * 60 * 1000);
    }
}, 60 * 1000);

// 应用退出时停止清理
window.addEventListener('beforeunload', stopCleanup);
```

### 5. 优雅降级

```typescript
// 检查是否可执行
const status = registry.getPoolStatus();
if (status.available === 0) {
    showToast(`Queue is full (${status.queued} waiting). Please wait.`);
    return;
}

// 设置优先级
await registry.submitTask(sessionId, input, {
    priority: isUrgent ? 10 : 0
});
```

## 调试

```typescript
// 输出调试信息
registry.debug();

// 输出示例：
// [SessionRegistry] Debug Info
//   Initialized: true
//   Registered Sessions: 3
//   Active Session: abc-123
//   Running Tasks: 1
//   Queued Tasks: 2
//   Max Concurrent: 3
//   Sessions:
//     abc-123: status=running, messages=5, unread=0
//     def-456: status=idle, messages=12, unread=2
//     ghi-789: status=completed, messages=8, unread=1
```

## 依赖

| 包 | 版本 | 说明 |
|----|------|------|
| `@itookit/llm-kernel` | workspace:* | 执行引擎 |
| `@itookit/llm-driver` | workspace:* | LLM 通信 |
| `@itookit/vfs-core` | workspace:* | 虚拟文件系统 |

## 许可证

MIT