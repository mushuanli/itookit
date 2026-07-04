/**
 * @file apps/tauri-app/src/log/tauri-llm-logger.ts
 * @description TauriLLMLogger — persists complete LLM exchange to {rootDir}/var/log/llm/{session}.json
 *
 * Buffers user message, full request params, response headers, and assistant response,
 * then flushes a single JSON file with the complete picture. Overwrite mode — only
 * the latest exchange is kept per session.
 */

import { invoke } from '@tauri-apps/api/core';
import type { ILLMLogger, LLMRequestLog, LLMResponseLog } from '@itookit/common';

interface LogRecord {
    userContent?: string;
    userRole?: 'user' | 'system';
    request?: LLMRequestLog;
    response?: LLMResponseLog;
    assistantContent?: string;
    ts: string;
}

export class TauriLLMLogger implements ILLMLogger {
    constructor(private rootDir: string) {}

    private pending = new Map<string, LogRecord>();

    logMessage(session: string, role: 'user' | 'assistant' | 'system', content: string): void {
        let rec = this.pending.get(session);
        if (!rec) { rec = { ts: new Date().toISOString() }; this.pending.set(session, rec); }

        if (role === 'user' || role === 'system') {
            rec.userContent = content;
            rec.userRole = role;
        } else {
            rec.assistantContent = content;
            this.flush(session, rec);
        }
    }

    logRequest(session: string, request: LLMRequestLog): void {
        let rec = this.pending.get(session);
        if (!rec) { rec = { ts: new Date().toISOString() }; this.pending.set(session, rec); }
        rec.request = request;
    }

    logResponse(session: string, response: LLMResponseLog): void {
        let rec = this.pending.get(session);
        if (!rec) { rec = { ts: new Date().toISOString() }; this.pending.set(session, rec); }
        rec.response = response;
    }

    private flush(session: string, rec: LogRecord): void {
        this.pending.delete(session);
        const payload = JSON.stringify({
            ts: rec.ts,
            session,
            user: rec.userContent ? { role: rec.userRole, content: rec.userContent } : undefined,
            request: rec.request,
            response: rec.response,
            assistant: rec.assistantContent,
        }, null, 2) + '\n';

        const encoder = new TextEncoder();
        const path = `${this.rootDir}/var/log/llm/${session}.json`;
        invoke('fs_write_file', {
            path,
            data: Array.from(encoder.encode(payload)),
        }).catch((e) => {
            console.warn('[TauriLLMLogger] write failed:', e);
        });
    }
}
