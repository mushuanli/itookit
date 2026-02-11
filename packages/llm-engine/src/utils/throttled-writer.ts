// @file: llm-engine/utils/throttled-writer.ts

import { ILLMSessionEngine } from '../persistence/types';
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
    engine: ILLMSessionEngine,
    sessionId: string,
    messageId: string,
    intervalMs: number = 1000
): ThrottledWriter {
    const accumulator = { output: '', thinking: '' };
    let lastPersistTime = Date.now();
    let pendingPromise: Promise<void> = Promise.resolve();
    let persistCount = 0;

    log.debug('ThrottledWriter created', {
        sessionId,
        messageId,
        intervalMs
    });

    const persist = () => {
        if (!accumulator.output && !accumulator.thinking) {
            log.debug('Persist skipped (no content)', {
                sessionId,
                messageId
            });
            return;
        }

        const now = Date.now();
        const timeSinceLastPersist = now - lastPersistTime;

        if (timeSinceLastPersist < intervalMs) {
            log.debug('Persist throttled', {
                sessionId,
                messageId,
                timeSinceLastPersist,
                intervalMs,
                outputLength: accumulator.output.length,
                thinkingLength: accumulator.thinking.length
            });
            return;
        }

        lastPersistTime = now;
        persistCount++;

        const outputSnapshot = accumulator.output;
        const thinkingSnapshot = accumulator.thinking;

        log.info('Persisting content', {
            sessionId,
            messageId,
            persistCount,
            outputLength: outputSnapshot.length,
            thinkingLength: thinkingSnapshot.length,
            timeSinceLastPersist
        });

        pendingPromise = pendingPromise
            .then(async () => {
                try {
                    await engine.updateNode(sessionId, messageId, {
                        content: outputSnapshot,
                        meta: { thinking: thinkingSnapshot, status: 'running' },
                    });

                    log.debug('Persist successful', {
                        sessionId,
                        messageId,
                        persistCount
                    });
                } catch (e) {
                    log.error('Persist failed', {
                        sessionId,
                        messageId,
                        persistCount,
                        error: e
                    });
                    throw e;
                }
            })
            .catch((e) => {
                log.warn('Persist error caught', {
                    sessionId,
                    messageId,
                    error: e
                });
            });
    };

    const finalize = async () => {
        log.info('Finalizing throttled writer', {
            sessionId,
            messageId,
            totalPersists: persistCount,
            finalOutputLength: accumulator.output.length,
            finalThinkingLength: accumulator.thinking.length
        });

        try {
            await pendingPromise;

            log.info('Finalize completed', {
                sessionId,
                messageId
            });
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
