// @file: llmdriver/errors.ts

export interface LLMErrorDetails {
    cause?: unknown;
    provider: string;
    statusCode?: number;
    requestBody?: any;
}

export class LLMError extends Error {
    public readonly provider: string;
    public readonly statusCode?: number;
    public readonly cause?: unknown;

    constructor(message: string, details: LLMErrorDetails) {
        super(message);
        this.name = 'LLMError';
        this.provider = details.provider;
        this.statusCode = details.statusCode;
        this.cause = details.cause;
    }
}
