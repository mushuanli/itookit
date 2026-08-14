// @file: llm-ui/services/SessionService.ts

import { IChatEngine, SessionSnapshot } from '@itookit/llm-session';
import type { ICommandBus } from '@itookit/common';
import { FSAlreadyExistsError } from '@itookit/stdio';
import type { ChatInputSettings } from '../domain/ports/IChatInputPresenter';

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
        private engine: IChatEngine,
        private commands: ICommandBus,
    ) { }

    /**
     * 确保 VFS 会话结构已就绪，供 ChatInput 渲染前调用。
     *
     * 创建 manifest + asset 目录（幂等），并绑定 sessionManager，
     * 使得后续 getSessionSettings / saveSessionSettings 可直接读写 VFS。
     */
    async ensureReady(nodeId: string, title: string): Promise<string> {
        const sessionId = await this.getOrCreateSessionId(nodeId, title);
        await this.commands.execute('session.bind', { nodeId, sessionId });
        return sessionId;
    }

    /**
     * 加载现有会话。若已通过 ensureReady 拿到 sessionId，传入可跳过重复解析。
     */
    async loadSession(nodeId: string, defaultTitle: string, knownSessionId?: string): Promise<SessionLoadResult> {
        const sessionId = knownSessionId ?? await this.getOrCreateSessionId(nodeId, defaultTitle);

        // 绑定会话并获取快照
        const snapshot = await this.commands.execute<SessionSnapshot>('session.bind', { nodeId, sessionId });

        // 加载标题
        const title = await this.getSessionTitle(nodeId, defaultTitle);

        return { sessionId, snapshot, title };
    }

    /**
     * 创建新会话
     */
    async createSession(title: string, parentId: string | null = null): Promise<{ nodeId: string; sessionId: string }> {
        const newNode = await this.engine.createFile(title, parentId);
        const sessionId = await this.engine.initializeExistingFile(newNode.path, title);
        return { nodeId: newNode.path, sessionId };
    }

    /**
     * 获取或创建 SessionId（幂等）
     *
     * 先尝试读取已有 manifest；不存在时初始化。如果初始化发现结构
     * 已存在（并发调用或路径修复后重新进入），则重试读取。
     */
    private async getOrCreateSessionId(nodeId: string, title: string): Promise<string> {
        try {
            const sessionId = await this.engine.getSessionIdFromNodeId(nodeId);
            if (sessionId) return sessionId;
        } catch (e) {
            console.warn('[SessionService] Error reading manifest:', e);
        }

        try {
            return await this.engine.initializeExistingFile(nodeId, title);
        } catch (e) {
            // Session structure already exists — a concurrent call or a
            // previous partial initialization created it. Re-read the manifest.
            if (e instanceof FSAlreadyExistsError) {
                console.warn('[SessionService] Session structure already initialized:', nodeId);
                const sessionId = await this.engine.getSessionIdFromNodeId(nodeId);
                if (sessionId) return sessionId;
                throw new Error(`Session structure exists for ${nodeId} but manifest is unreadable`);
            }
            throw e;
        }
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
    async getSessionSettings(): Promise<ChatInputSettings> {
        return await this.commands.execute<ChatInputSettings>('session.get-settings');
    }

    /**
     * 保存会话设置
     *
     * FSAlreadyExistsError is expected — the settings.yaml file is created
     * during session initialization and the engine may attempt to re-create
     * it on each save. We silently ignore this; the settings write succeeds
     * regardless (the file already exists and will be updated in-place).
     */
    async saveSessionSettings(settings: ChatInputSettings): Promise<void> {
        await this.commands.execute('session.save-settings', settings);
    }
}
