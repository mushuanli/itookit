// @file: llm-ui/helpers/SessionLoader.ts

import { SessionService, SessionLoadResult } from '../services';
import { HistoryView } from '../components/HistoryView';

export class SessionLoader {
    constructor(
        private sessionService: SessionService,
        private historyView: HistoryView
    ) {}

    /**
     * 从引擎加载会话
     */
    async loadSession(
        nodeId: string,
        currentTitle: string
    ): Promise<SessionLoadResult> {
        // 委托给 SessionService
        const result = await this.sessionService.loadSession(nodeId, currentTitle);

        // 渲染历史消息
        if (result.snapshot.sessions.length > 0) {
            this.historyView.renderFull(result.snapshot.sessions);
        } else {
            this.historyView.renderWelcome();
        }

        console.log(
            `[SessionLoader] Session loaded: ${result.sessionId}, ` +
            `messages: ${result.snapshot.sessions.length}, ` +
            `status: ${result.snapshot.status}`
        );

        return result;
    }
}
