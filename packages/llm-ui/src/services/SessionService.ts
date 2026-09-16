// @file: llm-ui/services/SessionService.ts


import { SessionCommand, ISessionRepository, SessionSnapshot } from '@itookit/llm-session';
import type { ICommandBus } from '@itookit/common';
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
        private engine: ISessionRepository,
        private commands: ICommandBus,
    ) { }

    async ensureReady(sessionId: string, branch?: string): Promise<string> {
        await this.engine.getManifest(sessionId);
        await this.commands.execute(SessionCommand.Bind, { sessionId });
        if (branch !== undefined) await this.commands.execute('vcs.branch.switch', { branchName: branch });
        return sessionId;
    }

    async loadSession(sessionId: string, defaultTitle: string): Promise<SessionLoadResult> {
        await this.engine.getManifest(sessionId);

        // 绑定会话并获取快照
        const snapshot = await this.commands.execute<SessionSnapshot>(SessionCommand.Bind, { sessionId });

        // 加载标题
        const title = await this.getSessionTitle(sessionId, defaultTitle);

        return { sessionId, snapshot, title };
    }

    private async getSessionTitle(sessionId: string, defaultTitle: string): Promise<string> {
        try {
            const manifest = await this.engine.getManifest(sessionId);
            return manifest.title || defaultTitle;
        } catch (e) {
            console.warn('[SessionService] Failed to load manifest:', e);
            return defaultTitle;
        }
    }

    async renameSession(sessionId: string, newTitle: string): Promise<void> {
        await this.engine.updateManifest(sessionId, { title: newTitle });
    }

    async getSessionSettings(): Promise<ChatInputSettings> {
        return await this.commands.execute<ChatInputSettings>(SessionCommand.GetSettings);
    }

    async saveSessionSettings(settings: ChatInputSettings): Promise<void> {
        await this.commands.execute(SessionCommand.SaveSettings, settings);
    }
}
