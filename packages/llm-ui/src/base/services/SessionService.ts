// @file: llm-ui/services/SessionService.ts

import { ILLMSessionEngine, SessionManager, SessionSnapshot } from '@itookit/llm-engine';

export interface SessionLoadResult {
    sessionId: string;
    snapshot: SessionSnapshot;
    title: string;
}

/**
 * 会话生命周期管理服务
 * 职责：会话的创建、加载、绑定、初始化
 */
export class SessionService {
    constructor(
        private engine: ILLMSessionEngine,
        private sessionManager: SessionManager
    ) { }

    /**
     * 加载现有会话
     */
    async loadSession(nodeId: string, defaultTitle: string): Promise<SessionLoadResult> {
        let sessionId = await this.getOrCreateSessionId(nodeId, defaultTitle);

        // 绑定会话并获取快照
        const snapshot = await this.sessionManager.bindSession(nodeId, sessionId);

        // 加载标题
        const title = await this.getSessionTitle(nodeId, defaultTitle);

        return { sessionId, snapshot, title };
    }

    /**
     * 创建新会话
     */
    async createSession(title: string, parentId: string | null = null): Promise<{ nodeId: string; sessionId: string }> {
        const newNode = await this.engine.createFile(title, parentId);
        const sessionId = await this.engine.initializeExistingFile(newNode.id, title);
        return { nodeId: newNode.id, sessionId };
    }

    /**
     * 获取或创建 SessionId
     */
    private async getOrCreateSessionId(nodeId: string, title: string): Promise<string> {
        try {
            const sessionId = await this.engine.getSessionIdFromNodeId(nodeId);
            if (sessionId) return sessionId;
        } catch (e) {
            console.warn('[SessionService] Error reading manifest:', e);
        }

        // 初始化新会话
        return await this.engine.initializeExistingFile(nodeId, title);
    }

    /**
     * 获取会话标题
     */
    private async getSessionTitle(nodeId: string, defaultTitle: string): Promise<string> {
        try {
            const manifest = await this.engine.getManifest(nodeId);
            return manifest.title || defaultTitle;
        } catch (e) {
            console.warn('[SessionService] Failed to load manifest:', e);
            return defaultTitle;
        }
    }

    /**
     * 重命名会话
     */
    async renameSession(nodeId: string, newTitle: string): Promise<void> {
        await this.engine.rename(nodeId, newTitle);
    }

    /**
     * 获取会话设置
     */
    async getSessionSettings() {
        return await this.sessionManager.getSessionSettings();
    }

    /**
     * 保存会话设置
     */
    async saveSessionSettings(settings: any): Promise<void> {
        await this.sessionManager.saveSessionSettings(settings);
    }
}
