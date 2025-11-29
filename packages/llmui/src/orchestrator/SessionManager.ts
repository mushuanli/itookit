// @file llm-ui/orchestrator/SessionManager.ts
import { SessionGroup, OrchestratorEvent, ExecutionNode, NodeStatus } from '../types';
import { generateUUID } from '@itookit/common';

type EventHandler = (event: OrchestratorEvent) => void;

export class SessionManager {
    private sessions: SessionGroup[] = [];
    private listeners: Set<EventHandler> = new Set();
    private isGenerating = false;
    private abortController: AbortController | null = null;
    private dirty = false;

    constructor(private settingsService: any) {}

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
        }
    }

    destroy() {
        this.abort();
        this.listeners.clear();
    }

    /**
     * 执行用户请求
     * 这里包含了一个"模拟编排器"，用于演示 UI 如何响应复杂的流式事件
     */
    async runUserQuery(text: string, files: File[]) {
        if (this.isGenerating) return;
        this.isGenerating = true;
        this.abortController = new AbortController();
        this.dirty = true;

        // 1. 创建 User Session
        const userSession: SessionGroup = {
            id: generateUUID(),
            timestamp: Date.now(),
            role: 'user',
            content: text
        };
        this.sessions.push(userSession);
        this.emit({ type: 'session_start', payload: userSession });

        // 2. 创建 Assistant Session (空壳)
        const agentRootId = generateUUID();
        const rootNode: ExecutionNode = {
            id: agentRootId,
            name: 'Orchestrator',
            type: 'agent',
            status: 'pending',
            startTime: Date.now(),
            data: {},
            children: []
        };
        
        const aiSession: SessionGroup = {
            id: generateUUID(),
            timestamp: Date.now(),
            role: 'assistant',
            executionRoot: rootNode
        };
        this.sessions.push(aiSession);
        
        // 延迟一点为了视觉效果
        await this.sleep(100);
        this.emit({ type: 'session_start', payload: aiSession });
        
        // === 开始模拟编排流程 ===
        
        // Step 1: Orchestrator Start
        this.emit({ type: 'node_start', payload: { node: rootNode } });
        await this.simulateStreaming(agentRootId, 'thought', 'Analyzing user request...');
        this.emit({ type: 'node_status', payload: { nodeId: agentRootId, status: 'running' } });

        // Step 2: Call Search Tool (Child Node)
        const toolId = generateUUID();
        const toolNode: ExecutionNode = {
            id: toolId,
            parentId: agentRootId,
            name: 'web_search',
            type: 'tool',
            status: 'running',
            startTime: Date.now(),
            data: { toolCall: { name: 'web_search', args: { query: text } } }
        };
        rootNode.children?.push(toolNode);
        
        await this.sleep(500);
        this.emit({ type: 'node_start', payload: { parentId: agentRootId, node: toolNode } });
        
        await this.sleep(1500); // Wait for tool
        this.emit({ type: 'node_status', payload: { nodeId: toolId, status: 'success', result: { titles: ['Result A', 'Result B'] } } });

        // Step 3: Orchestrator Final Response
        await this.simulateStreaming(agentRootId, 'thought', '\nSearch complete. Formulating response based on context.');
        
        const responseText = `Based on the search results for "${text}", here is what I found... \n\nThis is a demonstration of the **LLM Workspace** UI capabilities.`;
        await this.simulateStreaming(agentRootId, 'output', responseText);

        this.emit({ type: 'node_status', payload: { nodeId: agentRootId, status: 'success' } });
        this.emit({ type: 'finished', payload: { sessionId: aiSession.id } });

        this.isGenerating = false;
    }

    private async simulateStreaming(nodeId: string, field: 'thought'|'output', fullText: string) {
        const chunks = fullText.split(/(?=[ \n])/); // split by words/spaces
        for (const chunk of chunks) {
            if (this.abortController?.signal.aborted) break;
            this.emit({ type: 'node_update', payload: { nodeId, chunk, field } });
            await this.sleep(Math.random() * 50 + 20); // typing effect
        }
    }

    private sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
}
