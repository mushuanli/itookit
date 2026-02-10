// @file: llm-ui/helpers/SessionLoader.ts

import { ILLMSessionEngine, SessionManager, SessionSnapshot } from '@itookit/llm-engine';
import { HistoryView } from '../components/HistoryView';

export class SessionLoader {
    constructor(
        private engine: ILLMSessionEngine,
        private sessionManager: SessionManager,
        private historyView: HistoryView
    ) { }

    /**
     * 从引擎加载会话
     */
    async loadSession(
        nodeId: string,
        currentTitle: string
    ): Promise<{ sessionId: string; snapshot: SessionSnapshot; title: string }> {
        let sessionId: string | null = null;

        // 尝试从 NodeId 获取 SessionId
        try {
            sessionId = await this.engine.getSessionIdFromNodeId(nodeId);
        } catch (e) {
            console.warn('[SessionLoader] Error reading manifest:', e);
        }

        if (!sessionId) {
            // 如果文件是空的或者损坏，重新初始化
            console.log('[SessionLoader] Initializing file structure...');
            sessionId = await this.engine.initializeExistingFile(nodeId, currentTitle);
        }

        // 绑定会话并获取快照
        const snapshot = await this.sessionManager.bindSession(nodeId, sessionId);

        // 加载标题
        let title = currentTitle;
        try {
            const manifest = await this.engine.getManifest(nodeId);
            if (manifest.title) {
                title = manifest.title;
            }
        } catch (e) {
            console.warn('[SessionLoader] Failed to load manifest:', e);
        }

        // 渲染历史消息
        if (snapshot.sessions.length > 0) {
            this.historyView.renderFull(snapshot.sessions);
        } else {
            this.historyView.renderWelcome();
        }

        console.log(
            `[SessionLoader] Session loaded: ${sessionId}, ` +
            `messages: ${snapshot.sessions.length}, ` +
            `status: ${snapshot.status}`
        );

        return { sessionId, snapshot, title };
    }
}
