// @file llm-ui/orchestrator/PersistenceManager.ts

import { ILLMSessionEngine, ChatNode } from '@itookit/common';

/**
 * 持久化队列
 */
class PersistQueue {
    private queue: Promise<void> = Promise.resolve();
    private hasPendingWork = false;

    enqueue(fn: () => Promise<void>): void {
        this.hasPendingWork = true;
        this.queue = this.queue
            .then(fn)
            .catch(e => console.error('[PersistQueue] Error:', e))
            .finally(() => {});
    }

    async flush(): Promise<void> {
        await this.queue;
        this.hasPendingWork = false;
    }

    get isPending(): boolean {
        return this.hasPendingWork;
    }
}

/**
 * 持久化管理器
 * 职责：封装与 SessionEngine 的交互
 */
export class PersistenceManager {
    private persistQueue = new PersistQueue();

    constructor(private engine: ILLMSessionEngine) {}

    // ============== Message Operations ==============

    async appendMessage(
        nodeId: string,
        sessionId: string,
        role: ChatNode['role'],
        content: string,
        meta: any = {}
    ): Promise<string> {
        return this.engine.appendMessage(nodeId, sessionId, role, content, meta);
    }

    async updateNode(
        sessionId: string,
        nodeId: string,
        updates: Partial<Pick<ChatNode, 'content' | 'meta' | 'status'>>
    ): Promise<void> {
        return this.engine.updateNode(sessionId, nodeId, updates);
    }

    async deleteMessage(sessionId: string, nodeId: string): Promise<void> {
        return this.engine.deleteMessage(sessionId, nodeId);
    }

    async editMessage(
        nodeId: string,
        sessionId: string,
        originalNodeId: string,
        newContent: string
    ): Promise<string> {
        return this.engine.editMessage(nodeId, sessionId, originalNodeId, newContent);
    }

    // ============== Context Operations ==============

    async getSessionContext(nodeId: string, sessionId: string) {
        return this.engine.getSessionContext(nodeId, sessionId);
    }

    async getManifest(nodeId: string) {
        return this.engine.getManifest(nodeId);
    }

    async getNodeSiblings(sessionId: string, nodeId: string): Promise<ChatNode[]> {
        return this.engine.getNodeSiblings(sessionId, nodeId);
    }

    // ============== Queue Operations ==============

    /**
     * 入队持久化操作（用于流式写入）
     */
    enqueuePersist(fn: () => Promise<void>): void {
        this.persistQueue.enqueue(fn);
    }

    /**
     * 等待所有持久化操作完成
     */
    async flush(): Promise<void> {
        await this.persistQueue.flush();
    }

    /**
     * 创建节流持久化函数
     */
    createThrottledPersist(
        sessionId: string,
        nodeId: string,
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
                    await this.updateNode(sessionId, nodeId, {
                        content: outputSnapshot,
                        meta: { thinking: thinkingSnapshot, status: 'running' }
                    });
                } catch (e) {
                    console.warn('[PersistenceManager] Persist failed:', e);
                }
            });
        };

        const finalize = async () => {
            await this.flush();
        };

        return { accumulator, persist, finalize };
    }
}
