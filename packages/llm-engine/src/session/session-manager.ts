// @file: llm-engine/session/session-manager.ts

import { 
    SessionRegistry, 
    getSessionRegistry 
} from './session-registry';
import { 
    SessionGroup, 
    SessionStatus, 
    OrchestratorEvent 
} from '../core/types';
import { EngineError, EngineErrorCode } from '../core/errors';

/**
 * 删除选项
 */
export interface DeleteOptions {
    /** 删除模式：soft=软删除, hard=物理删除 */
    mode?: 'soft' | 'hard';
    /** 是否级联删除子节点 */
    cascade?: boolean;
    /** 是否删除关联的响应消息 */
    deleteAssociatedResponses?: boolean;
}

/**
 * 重试选项
 */
export interface RetryOptions {
    /** 使用的 Agent ID */
    agentId?: string;
    /** 是否保留当前回复（创建分支） */
    preserveCurrent?: boolean;
    /** 是否导航到新分支 */
    navigateToNew?: boolean;
}

/**
 * 会话管理器
 * 单会话视图代理，封装对 SessionRegistry 的调用
 */
export class SessionManager {
    private registry: SessionRegistry;
    private sessionId: string | null = null;
    private nodeId: string | null = null;
    private eventUnsubscribe: (() => void) | null = null;
    private bindingVersion = 0;
    
    constructor() {
        this.registry = getSessionRegistry();
    }
    
    // ================================================================
    // 会话绑定
    // ================================================================
    
    /**
     * 绑定到会话
     */
    async bindSession(nodeId: string, sessionId: string): Promise<void> {
        const currentVersion = ++this.bindingVersion;
        
        // 解绑之前的会话
        this.unbindSession();
        this.bindingVersion = currentVersion;
        
        try {
            await this.registry.registerSession(nodeId, sessionId);
            
            // 检查绑定是否过期
            if (this.bindingVersion !== currentVersion) {
                console.log(`[SessionManager] Bind cancelled (stale version)`);
                this.registry.unregisterSession(sessionId, { keepInBackground: true }).catch(() => {});
                return;
            }
            
            this.nodeId = nodeId;
            this.sessionId = sessionId;
            this.registry.setActiveSession(sessionId);
            
            console.log(`[SessionManager] Bound to session: ${sessionId}`);
        } catch (e) {
            console.error('[SessionManager] Bind failed:', e);
            throw EngineError.from(e);
        }
    }
    
    /**
     * 解绑会话
     */
    unbindSession(): void {
        this.bindingVersion++;
        
        if (this.eventUnsubscribe) {
            this.eventUnsubscribe();
            this.eventUnsubscribe = null;
        }
        
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
    // 状态查询
    // ================================================================
    
    /**
     * 获取所有消息
     */
    getSessions(): SessionGroup[] {
        if (!this.sessionId) return [];
        return this.registry.getSessionMessages(this.sessionId);
    }
    
    /**
     * 获取当前会话 ID
     */
    getCurrentSessionId(): string | null {
        return this.sessionId;
    }
    
    /**
     * 获取当前节点 ID
     */
    getCurrentNodeId(): string | null {
        return this.nodeId;
    }
    
    /**
     * 获取状态
     */
    getStatus(): SessionStatus | 'unbound' {
        if (!this.sessionId) return 'unbound';
        return this.registry.getSessionRuntime(this.sessionId)?.status || 'idle';
    }
    
    /**
     * 是否正在生成
     */
    isGenerating(): boolean {
        if (!this.sessionId) return false;
        const runtime = this.registry.getSessionRuntime(this.sessionId);
        return runtime?.status === 'running' || runtime?.status === 'queued';
    }
    
    /**
     * 是否有未保存的更改
     */
    hasUnsavedChanges(): boolean {
        return false; // Engine 自动保存
    }
    
    // ================================================================
    // 事件订阅
    // ================================================================
    
    /**
     * 订阅会话事件
     */
    onEvent(handler: (event: OrchestratorEvent) => void): () => void {
        if (!this.sessionId) {
            return () => {};
        }
        
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
            throw new EngineError(EngineErrorCode.SESSION_INVALID, 'No session bound');
        }
        
        await this.registry.submitTask(this.sessionId, {
            text,
            files,
            executorId
        });
    }
    
    /**
     * 中止执行
     */
    abort(): void {
        if (this.sessionId) {
            this.registry.abortSession(this.sessionId).catch(console.error);
        }
    }
    
    // ================================================================
    // 消息操作 API
    // ================================================================
    
    /**
     * 删除消息
     * @param id 消息 ID
     * @param options 删除选项
     */
    async deleteMessage(id: string, options?: DeleteOptions): Promise<void> {
        if (!this.sessionId) {
            throw new EngineError(EngineErrorCode.SESSION_INVALID, 'No session bound');
        }
        
        // 合并默认选项
        const opts: DeleteOptions = {
            mode: 'soft',
            cascade: false,
            deleteAssociatedResponses: true,
            ...options
        };
        
        await this.registry.deleteMessage(this.sessionId, id, opts);
    }
    
    /**
     * 更新消息内容（不触发重新执行）
     * @param id 消息 ID  
     * @param content 新内容
     * @param type 消息类型
     */
    async updateContent(id: string, content: string, type: 'user' | 'node'): Promise<void> {
        if (!this.sessionId) {
            throw new EngineError(EngineErrorCode.SESSION_INVALID, 'No session bound');
        }
        
        // updateContent 是编辑的简化版，不触发重新执行
        await this.registry.editMessage(this.sessionId, id, content, false);
    }
    
    /**
     * 编辑消息
     * @param id 消息 ID
     * @param content 新内容
     * @param autoRerun 是否自动重新执行
     */
    async editMessage(id: string, content: string, autoRerun: boolean = false): Promise<void> {
        if (!this.sessionId) {
            throw new EngineError(EngineErrorCode.SESSION_INVALID, 'No session bound');
        }
        await this.registry.editMessage(this.sessionId, id, content, autoRerun);
    }
    
    /**
     * 重试生成
     * @param assistantId 助手消息 ID
     * @param options 重试选项
     */
    async retryGeneration(assistantId: string, options?: RetryOptions): Promise<void> {
        if (!this.sessionId) {
            throw new EngineError(EngineErrorCode.SESSION_INVALID, 'No session bound');
        }
        
        await this.registry.retryGeneration(this.sessionId, assistantId, {
            agentId: options?.agentId,
            preserveCurrent: options?.preserveCurrent ?? true
        });
        
        // 如果需要导航到新分支，这里可以添加逻辑
        // 但通常 UI 会通过事件自动处理
    }
    
    /**
     * 重发用户消息
     * @param userSessionId 用户消息 ID
     */
    async resendUserMessage(userSessionId: string): Promise<void> {
        if (!this.sessionId) {
            throw new EngineError(EngineErrorCode.SESSION_INVALID, 'No session bound');
        }
        
        const sessions = this.getSessions();
        const session = sessions.find(s => s.id === userSessionId);
        
        if (!session || session.role !== 'user') {
            throw new EngineError(EngineErrorCode.SESSION_INVALID, 'Invalid user session');
        }
        
        // 重发 = 编辑(内容不变) + 自动运行
        await this.registry.editMessage(
            this.sessionId, 
            userSessionId, 
            session.content || '', 
            true
        );
    }
    
    // ================================================================
    // 检查 API
    // ================================================================
    
    /**
     * 检查是否可以删除
     */
    canDeleteMessage(id: string): { allowed: boolean; reason?: string } {
        if (this.isGenerating()) {
            return { allowed: false, reason: 'Cannot delete while generating' };
        }
        return { allowed: true };
    }
    
    /**
     * 检查是否可以重试
     */
    canRetry(sessionGroupId: string): { allowed: boolean; reason?: string } {
        if (this.isGenerating()) {
            return { allowed: false, reason: 'Already generating' };
        }
        return { allowed: true };
    }
    
    /**
     * 检查是否可以编辑
     */
    canEdit(sessionGroupId: string): { allowed: boolean; reason?: string } {
        if (this.isGenerating()) {
            return { allowed: false, reason: 'Cannot edit while generating' };
        }
        return { allowed: true };
    }
    
    // ================================================================
    // 分支导航 API
    // ================================================================
    
    /**
     * 获取兄弟分支
     * @param sessionGroupId 消息 ID
     */
    async getSiblings(sessionGroupId: string): Promise<SessionGroup[]> {
        if (!this.sessionId) return [];
        
        // 通过 Registry 获取
        const siblings = await this.registry.getNodeSiblings(this.sessionId, sessionGroupId);
        return siblings;
    }
    
    /**
     * 切换到兄弟分支
     * @param sessionGroupId 消息 ID
     * @param siblingIndex 目标分支索引
     */
    async switchToSibling(sessionGroupId: string, siblingIndex: number): Promise<void> {
        if (!this.sessionId || !this.nodeId) return;
        
        await this.registry.switchToSibling(
            this.nodeId,
            this.sessionId, 
            sessionGroupId, 
            siblingIndex
        );
    }
    
    // ================================================================
    // 执行器 API
    // ================================================================
    
    /**
     * 获取可用的执行器列表
     */
    async getAvailableExecutors(): Promise<Array<{
        id: string;
        name: string;
        icon?: string;
        category?: string;
        description?: string;
    }>> {
        return this.registry.getAvailableExecutors();
    }
    
    // ================================================================
    // 导出
    // ================================================================
    
    /**
     * 导出为 Markdown
     */
    exportToMarkdown(): string {
        if (!this.sessionId) return '';
        return this.registry.exportToMarkdown(this.sessionId);
    }
    
    // ================================================================
    // 生命周期
    // ================================================================
    
    /**
     * 销毁
     */
    destroy(): void {
        this.unbindSession();
    }
}
