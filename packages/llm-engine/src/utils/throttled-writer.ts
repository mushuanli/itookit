// @file: llm-engine/utils/throttled-writer.ts
//
// @deprecated S4: DraftArea subsumes throttled content persistence.
//             Once streaming content flows through DraftArea.setCurrent(),
//             this standalone module can be removed.

import { IChatEngine } from '../persistence/types';
import { log } from './logger';

export interface ThrottledWriter {
    accumulator: { output: string; thinking: string };
    persist: () => void;
    finalize: () => Promise<void>;
}

/**
 * 创建节流写入器
 * 将流式输出按时间间隔批量写入持久化层
 */
export function createThrottledWriter(
    engine: IChatEngine,
    sessionId: string,
    messageId: string,
    intervalMs: number = 1000
): ThrottledWriter {
    const accumulator = { output: '', thinking: '' };
    let lastPersistTime = Date.now();
    let pendingPromise: Promise<void> = Promise.resolve();
    let persistCount = 0;


    const persist = () => {
        if (!accumulator.output && !accumulator.thinking) return;

        const now = Date.now();
        if (now - lastPersistTime < intervalMs) return;

        lastPersistTime = now;
        persistCount++;

        const outputSnapshot = accumulator.output;
        const thinkingSnapshot = accumulator.thinking;


        pendingPromise = pendingPromise
            .then(async () => {
                try {
                    await engine.updateNode(sessionId, messageId, {
                        content: outputSnapshot,
                        meta: { thinking: thinkingSnapshot, status: 'running' },
                    });
                } catch (e) {
                    // 只有失败时记录，保留关键上下文
                    log.error('Throttled persist failed', {
                        sessionId,
                        messageId,
                        persistCount,
                        error: e instanceof Error ? e.message : e
                    });
                    throw e;
                }
            })
            .catch((e) => {
                /* 错误已在上面 log.error 记录，此处防止 promise chain 中断 */
                console.warn('[DEBUG-ASSET] throttled-writer persist catch (chain kept alive):', e instanceof Error ? e.message : e);
            });
    };

    const finalize = async () => {
        try {
            await pendingPromise;
        } catch (e) {
            log.error('Finalize failed', {
                sessionId,
                messageId,
                error: e
            });
            throw e;
        }
    };

    return { accumulator, persist, finalize };
}
