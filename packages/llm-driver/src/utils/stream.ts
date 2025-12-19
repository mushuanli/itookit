// @file: llm-driver/utils/stream.ts

/**
 * 解析 SSE 流
 * 
 * @param stream ReadableStream
 * @yields 每个 data 事件的内容
 */
export async function* parseSSEStream(
    stream: ReadableStream<Uint8Array>
): AsyncGenerator<string> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    
    let buffer = '';
    
    try {
        while (true) {
            const { done, value } = await reader.read();
            
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            
            // 按行分割
            const lines = buffer.split('\n');
            
            // 保留最后一个不完整的行
            buffer = lines.pop() || '';
            
            for (const line of lines) {
                const trimmed = line.trim();
                
                // 跳过空行和注释
                if (!trimmed || trimmed.startsWith(':')) {
                    continue;
                }
                
                // 解析 data 行
                if (trimmed.startsWith('data:')) {
                    const data = trimmed.slice(5).trim();
                    
                    // [DONE] 标记
                    if (data === '[DONE]') {
                        yield '[DONE]';
                        continue;
                    }
                    
                    yield data;
                }
            }
        }
        
        // 处理剩余缓冲区
        if (buffer.trim()) {
            const trimmed = buffer.trim();
            if (trimmed.startsWith('data:')) {
                const data = trimmed.slice(5).trim();
                if (data && data !== '[DONE]') {
                    yield data;
                }
            }
        }
        
    } finally {
        reader.releaseLock();
    }
}

/**
 * 创建可取消的流
 */
export function createCancellableStream<T>(
    stream: AsyncGenerator<T>,
    signal?: AbortSignal
): AsyncGenerator<T> {
    if (!signal) return stream;
    
    return (async function* () {
        for await (const chunk of stream) {
            if (signal.aborted) {
                throw new DOMException('Aborted', 'AbortError');
            }
            yield chunk;
        }
    })();
}

/**
 * 合并多个流
 */
export async function* mergeStreams<T>(
    streams: AsyncGenerator<T>[]
): AsyncGenerator<T> {
    const iterators = streams.map(s => s[Symbol.asyncIterator]());
    const pending = new Set(iterators.map((it, i) => ({ iterator: it, index: i })));
    
    while (pending.size > 0) {
        const promises = Array.from(pending).map(async ({ iterator, index }) => {
            const result = await iterator.next();
            return { result, index, iterator };
        });
        
        const { result, index, iterator } = await Promise.race(promises);
        
        if (result.done) {
            pending.delete({ iterator, index });
        } else {
            yield result.value;
        }
    }
}
