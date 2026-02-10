// @file: llm-ui/services/ContentService.ts

import { SessionManager, SessionGroup } from '@itookit/llm-engine';

export interface DeleteOptions {
    mode: 'soft' | 'hard';
    cascade: boolean;
    deleteAssociatedResponses: boolean;
}

export interface RetryOptions {
    preserveCurrent?: boolean;
    navigateToNew?: boolean;
    fallbackAgentId?: string;
}

/**
 * 内容操作服务
 * 职责：消息的增删改查、重试、编辑
 */
export class ContentService {
    constructor(private sessionManager: SessionManager) { }

    /**
     * 更新内容
     */
    async updateContent(id: string, content: string, type: 'user' | 'node'): Promise<void> {
        await this.sessionManager.updateContent(id, content, type);
    }

    /**
     * 删除消息
     */
    async deleteMessage(nodeId: string, options: DeleteOptions): Promise<void> {
        await this.sessionManager.deleteMessage(nodeId, options);
    }

    /**
     * 编辑并重新生成
     */
    async editAndRetry(nodeId: string, newContent: string): Promise<void> {
        await this.sessionManager.editMessage(nodeId, newContent, true);
    }

    /**
     * 重新发送用户消息
     */
    async resendUserMessage(nodeId: string, options: { fallbackAgentId: string }): Promise<void> {
        await this.sessionManager.resendUserMessage(nodeId, options);
    }

    /**
     * 重试生成
     */
    async retryGeneration(nodeId: string, options: RetryOptions): Promise<void> {
        await this.sessionManager.retryGeneration(nodeId, options);
    }

    /**
     * 切换分支
     */
    async switchToSibling(nodeId: string, newIndex: number): Promise<void> {
        await this.sessionManager.switchToSibling(nodeId, newIndex);
    }

    /**
     * 导出为 Markdown
     */
    exportToMarkdown(): string {
        return this.sessionManager.exportToMarkdown();
    }

    /**
     * 获取会话列表
     */
    getSessions(): SessionGroup[] {
        return this.sessionManager.getSessions();
    }

    /**
     * 检查是否可以重试
     */
    canRetry(sessionId: string) {
        return this.sessionManager.canRetry(sessionId);
    }

    /**
     * 获取会话状态
     */
    getStatus(): string {
        return this.sessionManager.getStatus();
    }

    /**
     * 检查是否正在生成
     */
    isGenerating(): boolean {
        return this.sessionManager.isGenerating();
    }

    /**
     * 中止生成
     */
    abort(): void {
        this.sessionManager.abort();
    }

    /**
     * 运行用户查询
     */
    async runUserQuery(
        text: string,
        files: File[],
        agentId: string,
        overrides?: { modelId?: string; historyLength?: number; temperature?: number }
    ): Promise<void> {
        await this.sessionManager.runUserQuery(text, files, agentId, overrides);
    }

    /**
     * 获取指定 Agent 的可用模型
     */
    async getAvailableModelsForAgent(agentId: string) {
        return await this.sessionManager.getAvailableModelsForAgent(agentId);
    }
}
