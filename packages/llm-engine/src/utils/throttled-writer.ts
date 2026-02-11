// @file: llm-engine/utils/throttled-writer.ts

import { ILLMSessionEngine } from '../persistence/types';

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

    const persist = () => {
        if (!accumulator.output && !accumulator.thinking) return;

        const now = Date.now();
        if (now - lastPersistTime < intervalMs) return;

        lastPersistTime = now;
        const outputSnapshot = accumulator.output;
        const thinkingSnapshot = accumulator.thinking;

        pendingPromise = pendingPromise
            .then(() =>
                engine.updateNode(sessionId, messageId, {
                    content: outputSnapshot,
                    meta: { thinking: thinkingSnapshot, status: 'running' },
                })
            )
            .catch((e) => console.warn('[ThrottledWriter] Persist failed:', e));
    };

    const finalize = async () => {
        await pendingPromise;
    };

    return { accumulator, persist, finalize };
}
