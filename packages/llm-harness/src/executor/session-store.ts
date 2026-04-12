// @file: llm-harness/src/executor/session-store.ts
// Q2: Lightweight localStorage-based persistence for harness sessions.
//
// Persists session state so that interrupted/crashed tasks can be detected
// and recovered on the next page load. Only the minimal state needed to
// resume is stored: the original task request + message history.
//
// Browser safety: localStorage is not available in Node.js; all calls are
// guarded with typeof localStorage checks.

import type { AgentTaskRequest, AgentUsageSnapshot, AgentStatus } from '@itookit/common';
import type { ChatMessage } from '@itookit/common';

const KEY_PREFIX = 'harness:session:';
const MAX_STORED_SESSIONS = 5;   // prune old ones to avoid storage bloat
const MAX_MSG_CHARS = 200_000;   // cap stored message content size

export interface PersistedSession {
    sessionId: string;
    task: AgentTaskRequest;
    messages: ChatMessage[];
    usage: AgentUsageSnapshot;
    status: AgentStatus;
    savedAt: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function store(): any | null {
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ls = (globalThis as any)['localStorage'];
        return typeof ls !== 'undefined' ? ls : null;
    } catch { return null; }
}

function key(sessionId: string): string {
    return `${KEY_PREFIX}${sessionId}`;
}

/** Save or update a session snapshot. Called after each LLM turn. */
export function saveSession(session: PersistedSession): void {
    const s = store();
    if (!s) return;
    try {
        // Trim message content to avoid quota errors.
        const slim: PersistedSession = {
            ...session,
            messages: session.messages.map((m) => {
                const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
                return { ...m, content: content.slice(0, MAX_MSG_CHARS) };
            }),
        };
        s.setItem(key(session.sessionId), JSON.stringify(slim));
        pruneOldSessions(s);
    } catch { /* storage quota exceeded — silently ignore */ }
}

/** Remove a session from storage (called on clean completion or explicit delete). */
export function removeSession(sessionId: string): void {
    store()?.removeItem(key(sessionId));
}

/** Load all persisted sessions that were running (interrupted). */
export function loadInterruptedSessions(): PersistedSession[] {
    const s = store();
    if (!s) return [];
    const sessions: PersistedSession[] = [];
    for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (!k?.startsWith(KEY_PREFIX)) continue;
        try {
            const p = JSON.parse(s.getItem(k)!) as PersistedSession;
            if (p.status === 'running') sessions.push(p);
        } catch { /* malformed entry */ }
    }
    return sessions.sort((a, b) => b.savedAt - a.savedAt);
}

/** Remove all persisted sessions (e.g., on explicit clear). */
export function clearAllSessions(): void {
    const s = store();
    if (!s) return;
    const toDelete: string[] = [];
    for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (k?.startsWith(KEY_PREFIX)) toDelete.push(k);
    }
    toDelete.forEach((k) => s.removeItem(k));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pruneOldSessions(s: any): void {
    const entries: Array<{ key: string; savedAt: number }> = [];
    for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        if (!k?.startsWith(KEY_PREFIX)) continue;
        try {
            const p = JSON.parse(s.getItem(k)!) as { savedAt?: number };
            entries.push({ key: k, savedAt: p.savedAt ?? 0 });
        } catch { /* skip */ }
    }
    if (entries.length <= MAX_STORED_SESSIONS) return;
    entries.sort((a, b) => a.savedAt - b.savedAt);
    entries.slice(0, entries.length - MAX_STORED_SESSIONS)
        .forEach((e) => s.removeItem(e.key));
}
