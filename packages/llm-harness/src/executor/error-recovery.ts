// @file: llm-harness/src/executor/error-recovery.ts
// Five-category LLM error recovery service.

import type { IErrorRecoveryService, RecoveryOptions } from '@itookit/common';
import type { ChatCompletionParams, ChatCompletionResponse, ILLMService } from '@itookit/common';

const HTTP_RATE_LIMIT = 429;
const HTTP_CONTEXT_LARGE = 413;
const HTTP_OVERLOAD = 529;

function isRateLimit(err: unknown): boolean { return hasStatus(err, HTTP_RATE_LIMIT); }
function isContextTooLarge(err: unknown): boolean { return hasStatus(err, HTTP_CONTEXT_LARGE); }
function isServiceOverload(err: unknown): boolean { return hasStatus(err, HTTP_OVERLOAD); }

function isOutputTruncated(response: ChatCompletionResponse): boolean {
    return response.choices[0]?.finish_reason === 'length';
}

function hasStatus(err: unknown, code: number): boolean {
    if (err == null || typeof err !== 'object') return false;
    return (err as Record<string, unknown>)['statusCode'] === code ||
           (err as Record<string, unknown>)['status'] === code;
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

export class ErrorRecoveryService implements IErrorRecoveryService {
    private currentConnectionId: string;
    private fallbackActive = false;

    constructor(
        private readonly llm: ILLMService,
        primaryConnectionId: string,
    ) {
        this.currentConnectionId = primaryConnectionId;
    }

    async callWithRecovery(
        connectionId: string,
        request: ChatCompletionParams,
        options: RecoveryOptions,
    ): Promise<ChatCompletionResponse> {
        this.currentConnectionId = connectionId;

        // Each error category has its own independent retry counter.
        let rateLimitRetries = 0;
        let contextRetries = 0;
        let truncationRetries = 0;

        // eslint-disable-next-line no-constant-condition
        while (true) {
            try {
                const response = await this.llm.chat(this.currentConnectionId, request);

                if (isOutputTruncated(response)) {
                    truncationRetries++;
                    if (truncationRetries <= options.maxTruncationRetries) {
                        continue; // silent retry
                    }
                    return response; // accept truncated response after exhausting retries
                }

                return response;
            } catch (err: unknown) {
                if (isRateLimit(err)) {
                    rateLimitRetries++;
                    if (rateLimitRetries > options.maxRetries) throw err;
                    const delayMs = options.baseDelayMs * Math.pow(2, rateLimitRetries - 1);
                    options.onRetry?.(rateLimitRetries, 'rate_limit', delayMs);
                    await sleep(delayMs);
                    continue;
                }

                if (isContextTooLarge(err)) {
                    contextRetries++;
                    if (contextRetries > options.maxRetries) throw err;
                    await options.onCompressionNeeded();
                    continue;
                }

                if (isServiceOverload(err) && !this.fallbackActive && options.fallbackConnectionId) {
                    const prev = this.currentConnectionId;
                    this.currentConnectionId = options.fallbackConnectionId;
                    this.fallbackActive = true;
                    options.onFallback?.(prev, this.currentConnectionId, 'service_overload');
                    continue;
                }

                throw err;
            }
        }
    }

    getCurrentConnectionId(): string { return this.currentConnectionId; }
    isFallbackActive(): boolean { return this.fallbackActive; }
    resetFallback(): void { this.fallbackActive = false; }
}
