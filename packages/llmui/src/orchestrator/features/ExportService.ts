// @file llm-ui/orchestrator/ExportService.ts

import { SessionGroup } from '../../core/types';
import { Converters } from '../core/Converters';

/**
 * 导出服务
 * 职责：将会话导出为各种格式
 */
export class ExportService {
    /**
     * 导出为 Markdown 格式
     */
    static toMarkdown(sessions: SessionGroup[]): string {
        let md = `# Chat Session Export\n\n`;
        const now = new Date().toLocaleString();
        md += `> Exported at: ${now}\n\n---\n\n`;

        for (const session of sessions) {
            md += Converters.sessionToMarkdown(session);
        }

        return md;
    }

    /**
     * 导出为 JSON 格式
     */
    static toJSON(sessions: SessionGroup[]): string {
        const exportData = sessions.map(session => ({
            id: session.id,
            timestamp: session.timestamp,
            role: session.role,
            content: session.role === 'user' 
                ? session.content 
                : session.executionRoot?.data.output,
            thinking: session.executionRoot?.data.thought,
            files: session.files,
            metadata: session.executionRoot?.data.metaInfo
        }));

        return JSON.stringify(exportData, null, 2);
    }

    /**
     * 导出为纯文本格式
     */
    static toPlainText(sessions: SessionGroup[]): string {
        let text = '';

        for (const session of sessions) {
            const role = session.role === 'user' ? 'User' : 'Assistant';
            const ts = new Date(session.timestamp).toLocaleTimeString();
            
            text += `[${role} - ${ts}]\n`;

            if (session.role === 'user') {
                text += `${session.content || '(Empty)'}\n`;
            } else if (session.executionRoot) {
                text += `${session.executionRoot.data.output || '(No output)'}\n`;
            }

            text += '\n---\n\n';
        }

        return text;
    }
}
