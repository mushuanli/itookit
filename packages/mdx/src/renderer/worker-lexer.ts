import { isLargeDocument } from '../editor/document-policy';
import { lexer, type TokensList } from 'marked';
import type { WorkerSyntax } from './worker-tokenizers';

export function needsWorker(text: string): boolean { return text.length > 32 * 1024 || isLargeDocument(text); }

/** Each job owns its worker, so cancellation actually interrupts the lexical regex. */
export function lexInWorker(text: string, syntax: WorkerSyntax[] = [], options: Record<string, boolean> = {},
    signal?: AbortSignal, create: () => Worker = () => new Worker(new URL('./markdown-lexer.worker.ts', import.meta.url), { type: 'module' })): Promise<TokensList> {
    if (signal?.aborted) return Promise.reject(cancelled());
    return new Promise((resolve, reject) => {
        const worker = create();
        let settled = false;
        const finish = (error?: unknown, tokens?: TokensList) => {
            if (settled) return;
            settled = true;
            worker.terminate(); signal?.removeEventListener('abort', abort);
            if (error) reject(error); else resolve(tokens!);
        };
        const abort = () => finish(cancelled());
        worker.onmessage = event => event.data.error ? finish(new Error(event.data.error)) : finish(undefined, event.data.tokens);
        worker.onerror = event => finish(new Error(event.message));
        worker.onmessageerror = () => finish(new Error('Invalid Markdown worker response'));
        signal?.addEventListener('abort', abort, { once: true });
        try { worker.postMessage({ text, syntax, options }); }
        catch (error) { finish(error); }
        if (signal?.aborted) abort();
    });
}

export async function lexTaskDocument(text: string, signal?: AbortSignal): Promise<TokensList | undefined> {
    if (!/\[[ xX]\]/.test(text)) return undefined;
    if (needsWorker(text)) return lexInWorker(text, [], {}, signal);
    signal?.throwIfAborted(); return lexer(text);
}

function cancelled(): Error { return Object.assign(new Error('Rendering cancelled'), { name: 'AbortError' }); }
