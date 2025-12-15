// @file: llm-engine/core/errors.ts

export enum EngineErrorCode {
    NETWORK_ERROR = 'NETWORK_ERROR',
    QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
    CONTEXT_LIMIT = 'CONTEXT_LIMIT',
    ABORTED = 'ABORTED',
    UNKNOWN = 'UNKNOWN',
    SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
    BUSY = 'BUSY'
}

export class EngineError extends Error {
    constructor(
        public code: EngineErrorCode,
        public message: string,
        public retryable: boolean = false,
        public originalError?: any
    ) {
        super(message);
        this.name = 'EngineError';
    }

    /**
     * 将任意错误转换为 EngineError
     */
    static from(error: any): EngineError {
        if (error instanceof EngineError) return error;
        
        const msg = error?.message || 'Unknown error';
        
        // 处理 AbortError
        if (msg.includes('AbortError') || error?.name === 'AbortError') {
            return new EngineError(EngineErrorCode.ABORTED, 'Operation aborted', true, error);
        }
        
        // 处理 Rate Limits
        if (msg.includes('429') || msg.includes('quota')) {
            return new EngineError(EngineErrorCode.QUOTA_EXCEEDED, 'Rate limit exceeded', true, error);
        }
        
        // 处理 Context Limit
        if (msg.includes('context length') || msg.includes('token limit')) {
            return new EngineError(EngineErrorCode.CONTEXT_LIMIT, 'Context limit exceeded', false, error);
        }
        
        return new EngineError(EngineErrorCode.UNKNOWN, msg, true, error);
    }
}
