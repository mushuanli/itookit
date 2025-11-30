// @file llm-ui/orchestrator/SessionManager.ts
import { SessionGroup, OrchestratorEvent, ExecutionNode, NodeStatus } from '../types';
import { generateUUID, LLMConnection } from '@itookit/common';
import { LLMDriver, ChatMessage, ChatCompletionChunk } from '@itookit/llmdriver';

type EventHandler = (event: OrchestratorEvent) => void;

// 定义 SettingsService 接口，解耦具体实现
export interface ISettingsService {
    getAgentConfig(agentId: string): Promise<any>; // 返回 AgentConfig
    getConnection(connectionId: string): Promise<LLMConnection | undefined>;
}

export class SessionManager {
    private sessions: SessionGroup[] = [];
    private listeners: Set<EventHandler> = new Set();
    private isGenerating = false;
    private abortController: AbortController | null = null;
    private dirty = false;

    // 当前选中的 Agent ID，默认使用系统默认
    private currentAgentId = 'default';

    constructor(private settingsService: ISettingsService) {}

    getSessions() { return this.sessions; }
    hasUnsavedChanges() { return this.dirty; }
    setDirty(d: boolean) { this.dirty = d; }

    onEvent(handler: EventHandler) {
        this.listeners.add(handler);
        return () => this.listeners.delete(handler);
    }

    private emit(event: OrchestratorEvent) {
        this.listeners.forEach(h => h(event));
    }

    load(data: any) {
        if (Array.isArray(data)) {
            this.sessions = data;
        } else if (data && data.sessions) {
            this.sessions = data.sessions;
        }
        this.dirty = false;
    }

    serialize() {
        return {
            version: 1,
            sessions: this.sessions
        };
    }

    abort() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
            this.isGenerating = false;
            // 可以在这里发出一个状态更新，标记最后节点为 interrupted
        }
    }

    destroy() {
        this.abort();
        this.listeners.clear();
    }

    /**
     * 将 Session 历史转换为 LLM 消息格式
     */
    private buildMessageHistory(systemPrompt?: string): ChatMessage[] {
        const messages: ChatMessage[] = [];

        // 1. System Prompt
        if (systemPrompt) {
            messages.push({ role: 'system', content: systemPrompt });
        }

        // 2. Chat History
        for (const session of this.sessions) {
            if (session.role === 'user' && session.content) {
                messages.push({ role: 'user', content: session.content });
            } else if (session.role === 'assistant' && session.executionRoot) {
                // 从执行树中提取最终回复
                // 简单起见，我们假设 output 字段存储了最终文本
                // 实际场景可能需要遍历 children 找到最终的 text 输出
                const content = session.executionRoot.data.output;
                if (content) {
                    messages.push({ role: 'assistant', content });
                }
            }
        }

        return messages;
    }

    /**
     * 执行用户请求 (使用 LLMDriver)
     */
    async runUserQuery(text: string, files: File[]) {
        if (this.isGenerating) return;
        this.isGenerating = true;
        this.abortController = new AbortController();
        this.dirty = true;

        try {
            // 1. 创建 User Session
            const userSession: SessionGroup = {
                id: generateUUID(),
                timestamp: Date.now(),
                role: 'user',
                content: text,
                // files: [] // TODO: 处理文件上传并转换
            };
            this.sessions.push(userSession);
            this.emit({ type: 'session_start', payload: userSession });

            // 2. 获取配置
            const agentConfig = await this.settingsService.getAgentConfig(this.currentAgentId);
            const connection = await this.settingsService.getConnection(agentConfig.connectionId);

            if (!connection) {
                throw new Error(`Connection not found: ${agentConfig.connectionId}`);
            }

            // 3. 初始化 LLM Driver
            const driver = new LLMDriver({
                connection: connection,
                
                // 显式填充必填字段 (从 connection 中获取)
                provider: connection.provider,
                apiKey: connection.apiKey || '', // 处理可能为 undefined 的情况
                
                // 覆盖模型和其他配置
                model: agentConfig.modelName || connection.model,
                // 强制开启 Thinking，或者根据 connection.metadata 判断
                supportsThinking: true 
            });

            // 4. 准备 Assistant Session UI
            const agentRootId = generateUUID();
            const rootNode: ExecutionNode = {
                id: agentRootId,
                name: agentConfig.name || 'Assistant',
                icon: '🤖',
                type: 'agent',
                status: 'running',
                startTime: Date.now(),
                data: { output: '', thought: '' },
                children: []
            };

            const aiSession: SessionGroup = {
                id: generateUUID(),
                timestamp: Date.now(),
                role: 'assistant',
                executionRoot: rootNode
            };
            this.sessions.push(aiSession);
            this.emit({ type: 'session_start', payload: aiSession });
            this.emit({ type: 'node_start', payload: { node: rootNode } });

            // 5. 调用 LLM
            const messages = this.buildMessageHistory(agentConfig.systemPrompt);
            
            // 确保包含当前用户输入 (虽然已经在 history 里了，但为了清晰，buildHistory 应该包含最新一条)
            // 检查 buildMessageHistory 逻辑，如果上面 push 了 userSession，那里已经包含了。
            
            const stream = await driver.chat.create({
                messages,
                stream: true,
                thinking: true, // 启用思考
                signal: this.abortController.signal
            });

            // 6. 处理流式响应
            for await (const chunk of stream) {
                if (this.abortController.signal.aborted) break;

                const delta = chunk.choices[0].delta;

                // 处理思考过程
                if (delta.thinking) {
                    rootNode.data.thought = (rootNode.data.thought || '') + delta.thinking;
                    this.emit({ 
                        type: 'node_update', 
                        payload: { nodeId: agentRootId, chunk: delta.thinking, field: 'thought' } 
                    });
                }

                // 处理内容输出
                if (delta.content) {
                    rootNode.data.output = (rootNode.data.output || '') + delta.content;
                    this.emit({ 
                        type: 'node_update', 
                        payload: { nodeId: agentRootId, chunk: delta.content, field: 'output' } 
                    });
                }
            }

            // 7. 完成
            rootNode.status = 'success';
            rootNode.endTime = Date.now();
            this.emit({ type: 'node_status', payload: { nodeId: agentRootId, status: 'success' } });
            this.emit({ type: 'finished', payload: { sessionId: aiSession.id } });

        } catch (error: any) {
            console.error("LLM Execution Error:", error);
            
            // 如果出错，更新 UI 状态
            if (this.sessions.length > 0) {
                const lastSession = this.sessions[this.sessions.length - 1];
                if (lastSession.role === 'assistant' && lastSession.executionRoot) {
                    const rootNode = lastSession.executionRoot;
                    rootNode.status = 'failed';
                    rootNode.data.output += `\n\n**Error**: ${error.message}`;
                    this.emit({ type: 'node_status', payload: { nodeId: rootNode.id, status: 'failed' } });
                    // 更新错误信息到界面
                    this.emit({ 
                        type: 'node_update', 
                        payload: { nodeId: rootNode.id, chunk: `\n\nError: ${error.message}`, field: 'output' } 
                    });
                }
            }
            throw error;
        } finally {
            this.isGenerating = false;
            this.abortController = null;
        }
    }
}
