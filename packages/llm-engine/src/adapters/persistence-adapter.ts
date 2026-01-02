// @file: llm-engine/src/adapters/persistence-adapter.ts

import { ILLMSessionEngine, ChatNode, ChatContextItem, ChatManifest } from '../persistence/types';

/**
 * 持久化队列
 */
class PersistQueue {
    private queue: Promise<void> = Promise.resolve();
    private pendingCount = 0;
    
    enqueue(fn: () => Promise<void>): void {
        this.pendingCount++;
        this.queue = this.queue
            .then(fn)
            .catch(e => console.error('[PersistQueue] Error:', e))
            .finally(() => {
                this.pendingCount--;
            });
    }
    
    async flush(): Promise<void> {
        await this.queue;
    }
    
    get isPending(): boolean {
        return this.pendingCount > 0;
    }
}

/**
 * 持久化适配器
 * 封装与 LLMSessionEngine 的交互
 */
export class PersistenceAdapter {
    private engine: ILLMSessionEngine;
    private persistQueue = new PersistQueue();
    
    constructor(engine: ILLMSessionEngine) {
        this.engine = engine;
    }
    
    // ============== 消息操作 ==============
    
    async appendMessage(
        nodeId: string,
        sessionId: string,
        role: ChatNode['role'],
        content: string,
        meta?: any
    ): Promise<string> {
        return this.engine.appendMessage(nodeId, sessionId, role, content, meta);
    }
    
    async updateMessage(
        sessionId: string,
        messageId: string,
        updates: Partial<Pick<ChatNode, 'content' | 'meta' | 'status'>>
    ): Promise<void> {
        return this.engine.updateNode(sessionId, messageId, updates);
    }
    
    async deleteMessage(sessionId: string, messageId: string): Promise<void> {
        return this.engine.deleteMessage(sessionId, messageId);
    }
    
    async editMessage(
        nodeId: string,
        sessionId: string,
        originalMessageId: string,
        newContent: string
    ): Promise<string> {
        return this.engine.editMessage(nodeId, sessionId, originalMessageId, newContent);
    }
    
    // ============== 上下文操作 ==============
    
    async getSessionContext(nodeId: string, sessionId: string): Promise<ChatContextItem[]> {
        return this.engine.getSessionContext(nodeId, sessionId);
    }
    
    async getManifest(nodeId: string): Promise<ChatManifest> {
        return this.engine.getManifest(nodeId);
    }
    
    async getNodeSiblings(sessionId: string, messageId: string): Promise<ChatNode[]> {
        return this.engine.getNodeSiblings(sessionId, messageId);
    }

    /**
     * ✅ 新增：读取资产
     */
    async readAsset(sessionId: string, path: string): Promise<Blob | null> {
        return this.engine.readSessionAsset(sessionId, path);
    }

    // ============== 分支操作 ==============
    
    /**
     * 切换分支
     */
    async switchToBranch(nodeId: string, _sessionId: string, targetNodeId: string): Promise<void> {
        // 获取 manifest
        const manifest = await this.engine.getManifest(nodeId);
        
        // 更新 current_head 指向目标节点
        manifest.current_head = targetNodeId;
        manifest.branches[manifest.current_branch] = targetNodeId;
        manifest.updated_at = new Date().toISOString();
        
        // 写回 manifest
        await this.engine.writeContent(nodeId, JSON.stringify(manifest, null, 2));
    }
    
    // ============== 队列操作 ==============
    
    enqueuePersist(fn: () => Promise<void>): void {
        this.persistQueue.enqueue(fn);
    }
    
    async flush(): Promise<void> {
        await this.persistQueue.flush();
    }
    
    /**
     * 创建节流持久化
     */
    createThrottledPersist(
        sessionId: string,
        messageId: string,
        interval: number = 500
    ): {
        accumulator: { output: string; thinking: string };
        persist: () => void;
        finalize: () => Promise<void>;
    } {
        const accumulator = { output: '', thinking: '' };
        let lastPersistTime = Date.now();
        
        const persist = () => {
            if (!accumulator.output && !accumulator.thinking) return;
            
            const now = Date.now();
            if (now - lastPersistTime < interval) return;
            
            lastPersistTime = now;
            const outputSnapshot = accumulator.output;
            const thinkingSnapshot = accumulator.thinking;
            
            this.enqueuePersist(async () => {
                try {
                    await this.updateMessage(sessionId, messageId, {
                        content: outputSnapshot,
                        meta: { thinking: thinkingSnapshot, status: 'running' }
                    });
                } catch (e) {
                    console.warn('[PersistenceAdapter] Persist failed:', e);
                }
            });
        };
        
        const finalize = async () => {
            await this.flush();
        };
        
        return { accumulator, persist, finalize };
    }
}
