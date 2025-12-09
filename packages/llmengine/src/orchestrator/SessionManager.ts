// @file: llm-engine/orchestrator/SessionManager.ts

import { SessionGroup, OrchestratorEvent } from '../core/types';
import { IExecutor } from '@itookit/common';
import { SessionRegistry, getSessionRegistry } from './SessionRegistry';
import { DeleteOptions } from './features/MessageOperations';
import { EngineError } from '../core/errors';

export interface RetryOptions {
    agentId?: string;
    preserveCurrent: boolean;
    navigateToNew: boolean;
}

/**
 * SessionManager - 会话管理器（代理层）
 * 
 * 职责：
 * 1. 作为单个会话的代理，封装对 SessionRegistry 的调用
 * 2. 提供与原有 API 兼容的接口
 * 3. 管理当前绑定的会话 ID
 * 
 * 设计理念：
 * - SessionManager 是 "轻量级视图代理"
 * - SessionRegistry 是 "全局状态管理中心"
 * - 一个 Editor 对应一个 SessionManager，但多个 SessionManager 共享一个 Registry
 */
export class SessionManager {
    private registry: SessionRegistry;
    private sessionId: string | null = null;
    private nodeId: string | null = null;
    private eventUnsubscribe: (() => void) | null = null;
    
    // [新增] 绑定版本控制，解决快速切换时的竞态问题
    private bindingVersion = 0;

    constructor() {
        this.registry = getSessionRegistry();
    }

    // ================================================================
    // 会话绑定
    // ================================================================

    /**
     * 绑定到特定会话
     */
    async bindSession(nodeId: string, sessionId: string): Promise<void> {
        // 自增版本号，标记新的绑定操作开始
        const currentVersion = ++this.bindingVersion;

        // 解绑之前的会话 (清理监听器)
        this.unbindSession();
        // 重置回当前版本，因为 unbind 会自增
        this.bindingVersion = currentVersion;

        try {
            // 注册并绑定
            await this.registry.registerSession(nodeId, sessionId);
            
            // [修复] 关键检查：如果在 await 期间发生了新的 bind/unbind，版本号会变
            if (this.bindingVersion !== currentVersion) {
                console.log(`[SessionManager] Bind cancelled for ${sessionId} (stale version)`);
                // 此时不应设置为当前会话，且可能需要清理刚注册的 session (如果需要)
                this.registry.unregisterSession(sessionId, { keepInBackground: true }).catch(()=>{});
                return;
            }
            
            this.nodeId = nodeId;
            this.sessionId = sessionId;

            // 设置为当前激活会话
            this.registry.setActiveSession(sessionId);

            console.log(`[SessionManager] Bound to session: ${sessionId}`);
        } catch (e) {
            console.error('[SessionManager] Bind failed:', e);
            throw EngineError.from(e);
        }
    }

    /**
     * 解绑当前会话
     */
    unbindSession(): void {
        // 版本号自增，立即使所有正在进行的异步 bind 失效
        this.bindingVersion++;

        if (this.eventUnsubscribe) {
            this.eventUnsubscribe();
            this.eventUnsubscribe = null;
        }

        // 注意：不注销 Registry 中的会话，只是解除本地绑定
        // 会话可能在后台继续运行
        this.sessionId = null;
        this.nodeId = null;
    }

    /**
     * 加载会话（兼容旧接口）
     */
    async loadSession(nodeId: string, sessionId: string): Promise<void> {
        await this.bindSession(nodeId, sessionId);
    }

    // ================================================================
    // 状态查询 API
    // ================================================================

    getSessions(): SessionGroup[] {
        if (!this.sessionId) return [];
        return this.registry.getSessionMessages(this.sessionId);
    }

    getCurrentSessionId(): string | null {
        return this.sessionId;
    }

    hasUnsavedChanges(): boolean {
        return false; // Engine 自动保存
    }

    /**
     * 获取当前会话状态
     */
    getStatus(): string {
        if (!this.sessionId) return 'unbound';
        const runtime = this.registry.getSessionRuntime(this.sessionId);
        return runtime?.status || 'unknown';
    }

    /**
     * 是否正在生成
     */
    isGenerating(): boolean {
        if (!this.sessionId) return false;
        const runtime = this.registry.getSessionRuntime(this.sessionId);
        return runtime?.status === 'running' || runtime?.status === 'queued';
    }

    // ================================================================
    // 事件订阅 API
    // ================================================================

    /**
     * 订阅当前会话的事件
     */
    onEvent(handler: (event: OrchestratorEvent) => void): () => void {
        if (!this.sessionId) {
            // console.warn('[SessionManager] Cannot subscribe: no session bound');
            return () => {};
        }

        // 取消之前的订阅
        if (this.eventUnsubscribe) {
            this.eventUnsubscribe();
        }

        this.eventUnsubscribe = this.registry.onSessionEvent(this.sessionId, handler);
        return this.eventUnsubscribe;
    }

    // ================================================================
    // 执行 API
    // ================================================================

    /**
     * 运行用户查询
     */
    async runUserQuery(text: string, files: File[], executorId: string): Promise<void> {
        if (!this.sessionId) {
            throw new Error('No session bound');
        }

        await this.registry.submitTask(this.sessionId, {
            text,
            files,
            executorId
        });
    }

    /**
     * 中止当前执行
     */
    abort(): void {
        if (this.sessionId) {
            this.registry.abortSession(this.sessionId).catch(console.error);
        }
    }

    // ================================================================
    // 消息操作 API
    // ================================================================

    async deleteMessage(id: string, options?: DeleteOptions): Promise<void> {
        if (!this.sessionId) throw new Error('No session bound');
        
        await this.registry.deleteMessage(this.sessionId, id, options || {
            mode: 'soft',
            cascade: false,
            deleteAssociatedResponses: true
        });
    }

    async updateContent(id: string, content: string, type: 'user' | 'node'): Promise<void> {
        if (!this.sessionId) throw new Error('No session bound');
        await this.registry.editMessage(this.sessionId, id, content, false);
    }

    async editMessage(
        sessionGroupId: string,
        newContent: string,
        autoRerun: boolean = false
    ): Promise<void> {
        if (!this.sessionId) throw new Error('No session bound');
        await this.registry.editMessage(this.sessionId, sessionGroupId, newContent, autoRerun);
    }

    // ================================================================
    // 重试 API
    // ================================================================

    canDeleteMessage(id: string): { allowed: boolean; reason?: string } {
        if (this.isGenerating()) {
            return { allowed: false, reason: 'Cannot delete while generating' };
        }
        return { allowed: true };
    }

    canRetry(sessionGroupId: string): { allowed: boolean; reason?: string } {
        if (this.isGenerating()) {
            return { allowed: false, reason: 'Already generating' };
        }
        return { allowed: true };
    }

    async retryGeneration(
        assistantSessionId: string,
        options: RetryOptions = { preserveCurrent: true, navigateToNew: true }
    ): Promise<void> {
        if (!this.sessionId) throw new Error('No session bound');
        
        await this.registry.retryGeneration(this.sessionId, assistantSessionId, {
            agentId: options.agentId,
            preserveCurrent: options.preserveCurrent
        });
    }

    async resendUserMessage(userSessionId: string): Promise<void> {
        if (!this.sessionId) throw new Error('No session bound');
        
        const sessions = this.getSessions();
        const session = sessions.find(s => s.id === userSessionId);
        
        if (!session || session.role !== 'user') {
            throw new Error('Invalid user session');
        }

        // 重发相当于：编辑原消息(内容不变) + 自动运行
        await this.registry.editMessage(this.sessionId, userSessionId, session.content || '', true);
    }

    // ================================================================
    // 分支导航 API
    // ================================================================

    /**
     * 获取兄弟分支
     * (需要在 SessionRegistry -> BranchNavigator 中实现)
     */
    async getSiblings(sessionGroupId: string): Promise<SessionGroup[]> {
        if (!this.sessionId) return [];
        // [TODO] 临时返回空，等待 Registry 完整实现 BranchNavigator 代理
        // 理想调用：return this.registry.getNodeSiblings(this.sessionId, sessionGroupId);
        return [];
    }

    /**
     * 切换到兄弟分支
     */
    async switchToSibling(sessionGroupId: string, siblingIndex: number): Promise<void> {
        if (!this.sessionId) return;
        // [TODO] 临时存根
        // await this.registry.switchBranch(this.sessionId, sessionGroupId, siblingIndex);
    }

    // ================================================================
    // 执行器 API
    // ================================================================

    registerExecutor(executor: IExecutor): void {
        // [Warning] 这是旧 API，现在应直接在 Engine 初始化时注册，或通过 AgentService
        console.warn('[SessionManager] registerExecutor is deprecated. Use AgentService or Registry directly.');
    }

    async getAvailableExecutors() {
        return this.registry.getAvailableExecutors();
    }

    // ================================================================
    // 导出 API
    // ================================================================

    exportToMarkdown(): string {
        if (!this.sessionId) return '';
        return this.registry.exportToMarkdown(this.sessionId);
    }

    // ================================================================
    // 生命周期
    // ================================================================

    destroy(): void {
        this.unbindSession();
    }
}
