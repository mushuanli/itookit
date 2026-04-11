// @file: llm-engine/src/services/hitl-queue.ts
// Human-in-the-Loop queue — serializes HITL requests so the human sees one at a time.
//
// Design:
//   - push() is a Promise that resolves when the human responds
//   - Multiple concurrent push() calls queue up internally
//   - UI subscribes to 'hitl:request' events, calls resolve() on user input
//   - Non-blocked todos continue executing while the queue waits

import type { HITLRequest } from '@itookit/common';

type HITLListener = (request: HITLRequest) => void;

interface QueueEntry {
    request: HITLRequest;
    resolve: (response: string) => void;
    reject: (err: Error) => void;
}

export class HITLQueue {
    private readonly queue: QueueEntry[] = [];
    private processing = false;
    private readonly listeners = new Set<HITLListener>();
    private readonly pending = new Map<string, (response: string) => void>();

    /**
     * Enqueue a HITL request. Awaits until the human provides a response.
     * Non-blocking for other todos — only this todo's execution awaits.
     */
    push(request: HITLRequest): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            this.queue.push({ request, resolve, reject });
            this.drain();
        });
    }

    /**
     * Called by UI when the human has responded to the current request.
     */
    resolve(requestId: string, response: string): void {
        const resolver = this.pending.get(requestId);
        if (resolver) {
            this.pending.delete(requestId);
            resolver(response);
            this.processing = false;
            this.drain();
        }
    }

    /** Subscribe to HITL requests (UI layer). Returns unsubscribe function. */
    on(listener: HITLListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /** Abort all pending requests (e.g. on mission cancel). */
    abortAll(reason = 'Mission cancelled'): void {
        const err = new Error(reason);
        for (const entry of this.queue) entry.reject(err);
        this.queue.length = 0;
        for (const [, resolver] of this.pending) resolver('');
        this.pending.clear();
        this.processing = false;
    }

    // ── Private ───────────────────────────────────────────────

    private drain(): void {
        if (this.processing || this.queue.length === 0) return;
        const entry = this.queue.shift()!;
        this.processing = true;
        this.pending.set(entry.request.id, entry.resolve);
        this.emit(entry.request);
    }

    private emit(request: HITLRequest): void {
        for (const listener of this.listeners) {
            try { listener(request); } catch { /* listener errors are non-fatal */ }
        }
    }
}
