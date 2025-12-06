// @file llm-ui/orchestrator/SessionManager.ts

import { SessionGroup, OrchestratorEvent, ExecutionNode } from '../core/types';
import { IExecutor, ILLMSessionEngine, ChatNode } from '@itookit/common';
import { IAgentService } from '../services/IAgentService';

// 导入拆分后的模块
import { SessionState } from './core/SessionState';
import { SessionEventEmitter } from './core/EventEmitter';
import { PersistenceManager } from './data/PersistenceManager';
import { ExecutorResolver } from './execution/ExecutorResolver';
import { TreeOperations } from './data/TreeOperations';
import { MessageOperations, DeleteOptions } from './features/MessageOperations';
import { BranchNavigator } from './features/BranchNavigator';
import { QueryRunner, RunOptions } from './execution/QueryRunner';
import { ExportService } from './features/ExportService';
import { Converters } from './core/Converters';

// 重试选项
export interface RetryOptions {
    agentId?: string;
    preserveCurrent: boolean;
    navigateToNew: boolean;
}

// 重新导出 DeleteOptions 供外部使用
//export { DeleteOptions };

/**
 * SessionManager - 门面类
 * 
 * 职责：协调各个子模块，提供统一的对外接口
 * 
 * 设计原则：
 * 1. 门面模式 - 简化复杂子系统的使用
 * 2. 单一职责 - 每个子模块只负责一个功能领域
 * 3. 依赖注入 - 便于测试和扩展
 */
export class SessionManager {
    // 核心状态
    private state: SessionState;
    private emitter: SessionEventEmitter;
    
    // 功能模块
    private persistence: PersistenceManager;
    private executorResolver: ExecutorResolver;
    private treeOps: TreeOperations;
    private messageOps: MessageOperations;
    private branchNav: BranchNavigator;
    private queryRunner: QueryRunner;

    constructor(
        private agentService: IAgentService,
        sessionEngine: ILLMSessionEngine
    ) {
        // 初始化核心组件
        this.state = new SessionState();
        this.emitter = new SessionEventEmitter();
        this.persistence = new PersistenceManager(sessionEngine);
        this.executorResolver = new ExecutorResolver(agentService);
        
        // 初始化功能模块
        this.treeOps = new TreeOperations(this.state);
        this.messageOps = new MessageOperations(this.state, this.emitter, this.persistence);
        this.branchNav = new BranchNavigator(this.state, this.emitter, this.persistence);
        this.queryRunner = new QueryRunner(
            this.state,
            this.emitter,
            this.persistence,
            this.executorResolver,
            this.treeOps
        );
    }

    // ================================================================
    // 状态查询 API
    // ================================================================

    getSessions(): SessionGroup[] {
        return this.state.getSessions();
    }

    getCurrentSessionId(): string | null {
        return this.state.getCurrentSessionId();
    }

    hasUnsavedChanges(): boolean {
        return false; // Engine 自动保存
    }

    // ================================================================
    // 事件订阅 API
    // ================================================================

    onEvent(handler: (event: OrchestratorEvent) => void): () => void {
        return this.emitter.subscribe(handler);
    }

    // ================================================================
    // 执行器管理 API
    // ================================================================

    registerExecutor(executor: IExecutor): void {
        this.executorResolver.register(executor);
    }

    async getAvailableExecutors(): Promise<Array<{
        id: string;
        name: string;
        icon: string;
        description?: string;
        category: string;
    }>> {
        return this.executorResolver.getAvailableExecutors();
    }

    // ================================================================
    // 会话加载 API
    // ================================================================

    async loadSession(nodeId: string, sessionId: string): Promise<void> {
        console.log(`[SessionManager] Loading session. Node: ${nodeId}, ID: ${sessionId}`);
        
        this.state.setCurrentSession(nodeId, sessionId);
        this.state.clearSessions();

        try {
            const context = await this.persistence.getSessionContext(nodeId, sessionId);

            for (const item of context) {
                const chatNode = item.node;

                // 跳过 system prompt
                if (chatNode.role === 'system') continue;

                // 跳过空内容的 assistant 消息
                if (chatNode.role === 'assistant' && !chatNode.content?.trim()) {
                    console.warn(`[SessionManager] Skipping empty assistant message: ${chatNode.id}`);
                    continue;
                }

                const sessionGroup = Converters.chatNodeToSessionGroup(chatNode);
                if (sessionGroup) {
                    this.state.addSession(sessionGroup);
                }
            }

            console.log(`[SessionManager] Loaded ${this.state.getSessions().length} session groups`);
        } catch (e) {
            console.error('[SessionManager] Failed to load session:', e);
            throw e;
        }
    }

    // ================================================================
    // 查询执行 API
    // ================================================================

    async runUserQuery(text: string, files: File[], executorId: string): Promise<void> {
        return this.queryRunner.run(text, files, executorId, {});
    }

    abort(): void {
        this.queryRunner.abort();
    }

    // ================================================================
    // 消息操作 API
    // ================================================================

    canDeleteMessage(id: string): { allowed: boolean; reason?: string } {
        return this.messageOps.canDeleteMessage(id);
    }

    async deleteMessage(id: string, options?: DeleteOptions): Promise<void> {
        return this.messageOps.deleteMessage(id, options || {
            mode: 'soft',
            cascade: false,
            deleteAssociatedResponses: true
        });
    }

    canEdit(sessionGroupId: string): { allowed: boolean; reason?: string } {
        return this.messageOps.canEdit(sessionGroupId);
    }

    async updateContent(id: string, content: string, type: 'user' | 'node'): Promise<void> {
        await this.messageOps.editMessage(id, content, false);
    }

    async editMessage(
        sessionGroupId: string,
        newContent: string,
        autoRerun: boolean = false
    ): Promise<void> {
        const result = await this.messageOps.editMessage(sessionGroupId, newContent, false);
        
        if (result.success && autoRerun) {
            // 删除关联的回复
            await this.messageOps.deleteAssociatedResponses(sessionGroupId);
            
            // 重新生成
            const session = this.state.findSessionById(sessionGroupId);
            if (session && session.role === 'user') {
                await this.queryRunner.run(newContent, [], 'default', {
                    skipUserMessage: true,
                    parentUserNodeId: result.newNodeId || session.persistedNodeId
                });
            }
        }
    }

    // ================================================================
    // 重试 API
    // ================================================================

    canRetry(sessionGroupId: string): { allowed: boolean; reason?: string } {
        return this.messageOps.canRetry(sessionGroupId);
    }

    async retryGeneration(
        assistantSessionId: string,
        options: RetryOptions = { preserveCurrent: true, navigateToNew: true }
    ): Promise<void> {
        const check = this.messageOps.canRetry(assistantSessionId);
        if (!check.allowed) {
            throw new Error(check.reason);
        }

        const assistantSession = this.state.findSessionById(assistantSessionId);
        if (!assistantSession || assistantSession.role !== 'assistant') {
            throw new Error('Invalid assistant session');
        }

        // 找到对应的 user message
        const userSession = this.messageOps.findUserMessageForAssistant(assistantSessionId);
        if (!userSession) {
            throw new Error('No user message found');
        }

        // 处理当前回复
        if (!options.preserveCurrent) {
            await this.deleteMessage(assistantSessionId, {
                mode: 'soft',
                cascade: false,
                deleteAssociatedResponses: false
            });
        }

        // 获取 agent ID
        const agentId = options.agentId ||
            assistantSession.executionRoot?.data.metaInfo?.agentId ||
            'default';

        // 通知 UI 重试开始
        this.emitter.emit({
            type: 'retry_started',
            payload: { originalId: assistantSessionId, newId: '' }
        } as any);

        // 重新执行
        await this.queryRunner.run(userSession.content || '', [], agentId, {
            skipUserMessage: true,
            parentUserNodeId: userSession.persistedNodeId
        });
    }

    async resendUserMessage(userSessionId: string): Promise<void> {
        const session = this.state.findSessionById(userSessionId);
        if (!session || session.role !== 'user') {
            throw new Error('Invalid user session');
        }

        // 删除关联的回复
        await this.messageOps.deleteAssociatedResponses(userSessionId);

        // 重新生成回复
        await this.queryRunner.run(
            session.content || '',
            [],
            'default',
            {
                skipUserMessage: true,
                parentUserNodeId: session.persistedNodeId
            }
        );
    }

    // ================================================================
    // 分支导航 API
    // ================================================================

    async getSiblings(sessionGroupId: string): Promise<SessionGroup[]> {
        return this.branchNav.getSiblings(sessionGroupId);
    }

    async switchToSibling(sessionGroupId: string, siblingIndex: number): Promise<void> {
        return this.branchNav.switchToSibling(sessionGroupId, siblingIndex);
    }

    // ================================================================
    // 导出 API
    // ================================================================

    exportToMarkdown(): string {
        return ExportService.toMarkdown(this.state.getSessions());
    }

    exportToJSON(): string {
        return ExportService.toJSON(this.state.getSessions());
    }

    exportToPlainText(): string {
        return ExportService.toPlainText(this.state.getSessions());
    }

    // ================================================================
    // 生命周期 API
    // ================================================================

    destroy(): void {
        this.queryRunner.abort();
        this.emitter.clear();
        this.state.clearSessions();
    }
}
