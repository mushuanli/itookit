// @file: llm-harness/src/executor/session-store.ts
//
// Deprecated: harness session persistence via localStorage has been removed.
// Session interrupted-state detection now uses VFS .chat file meta.status.
//
// removeSession() and clearAllSessions() are kept for one-time cleanup of
// legacy harness:session:* keys that may still exist in users' localStorage.

const KEY_PREFIX = 'harness:session:';

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

/** @deprecated No-op — VFS meta.status is now the source of truth for interruption detection. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
export function saveSession(_session: any): void {
    // No-op: VFS .chat meta.status now tracks execution state.
    // Interrupted sessions are detected from VFS on bindSession.
}

/** Remove a session from storage. Kept for legacy key cleanup. */
export function removeSession(sessionId: string): void {
    store()?.removeItem(key(sessionId));
}

/** @deprecated No-op — VFS is the source of truth. */
export function loadInterruptedSessions(): never[] {
    return [];
}

/** Remove all persisted sessions. Kept for legacy key cleanup. */
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
