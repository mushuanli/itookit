// @file: llm-ui/services/SessionService.ts


import { SessionCommand, ISessionRepository, SessionSnapshot, type ConversationManifest } from '@itookit/llm-session';
import type { ICommandBus } from '@itookit/common';
import type { ChatInputSettings } from '../domain/ports/IChatInputPresenter';

export interface SessionLoadResult {
    sessionId: string;
    snapshot: SessionSnapshot;
    title: string;
    manifest: ConversationManifest;
    settings: ChatInputSettings;
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

    async loadSession(sessionId: string, defaultTitle: string, branch?: string): Promise<SessionLoadResult> {
        let snapshot = await this.commands.execute<SessionSnapshot>(SessionCommand.Bind, { sessionId });
        if (branch !== undefined) {
            await this.commands.execute('vcs.branch.switch', { branchName: branch });
            // Branch selection changes the projection; read it without rebinding.
            snapshot = await this.commands.execute<SessionSnapshot>(SessionCommand.GetSnapshot);
        }
        const { manifest, settings } = this.engine.getLoadState
            ? await this.engine.getLoadState(sessionId)
            : { manifest: await this.engine.getManifest(sessionId), settings: await this.getSessionSettings() };
        return { sessionId, snapshot, title: manifest.title || defaultTitle, manifest, settings };
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
