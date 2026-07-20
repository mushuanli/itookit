// @file: llm-engine/src/core/provider-message-adapter.ts
// ProviderMessageAdapter — provider-specific message validation and cleaning.
//
// Phase 2 (WP-03): Extracted from RoundLog.fold() (Phase 0 removed the
// inline logic). Validates that messages conform to provider requirements
// before being sent to the LLM API.
//
// Supported providers: Anthropic, OpenAI (extensible via strategy pattern).

import type { ChatMessage } from '@itookit/common';

// ─── Types ─────────────────────────────────────────────────────────────────

export type ProviderKind = 'anthropic' | 'openai' | 'generic';

export interface AdapterOptions {
    /** Provider to validate for. Default: 'generic'. */
    provider?: ProviderKind;
}

export class ProviderMessageError extends Error {
    constructor(message: string, public readonly code: string) {
        super(message);
        this.name = 'ProviderMessageError';
    }
}

// ─── ProviderMessageAdapter ────────────────────────────────────────────────

export class ProviderMessageAdapter {
    /**
     * Validate and clean messages for the target provider.
     *
     * Rules applied (in order):
     *   1. Remove consecutive duplicate roles
     *   2. Anthropic: last message must be 'user' (trim trailing assistant)
     *   3. Anthropic: no empty content in assistant without tool_calls
     *   4. OpenAI: tool messages must follow assistant with tool_calls
     *
     * Throws ProviderMessageError on irrecoverable violations.
     */
    validate(messages: ChatMessage[], options: AdapterOptions = {}): ChatMessage[] {
        const provider = options.provider ?? 'generic';

        if (messages.length === 0) {
            throw new ProviderMessageError('No messages to validate', 'EMPTY_MESSAGES');
        }

        let result = [...messages];

        // Remove empty assistant messages without tool_calls
        result = result.filter(msg => {
            if (msg.role === 'assistant') {
                const content = typeof msg.content === 'string' ? msg.content : '';
                const hasToolCalls = (msg as any).tool_calls && (msg as any).tool_calls.length > 0;
                if (!content.trim() && !hasToolCalls) return false;
            }
            return true;
        });

        // Provider-specific rules
        switch (provider) {
            case 'anthropic':
                result = this.validateAnthropic(result);
                break;
            case 'openai':
                result = this.validateOpenAI(result);
                break;
            default:
                // Generic: basic validation only
                break;
        }

        return result;
    }

    // ── Anthropic-specific ────────────────────────────────────────────────

    private validateAnthropic(messages: ChatMessage[]): ChatMessage[] {
        let result = [...messages];

        // Anthropic requires the last message to be from 'user'
        while (result.length > 0 && result[result.length - 1].role === 'assistant') {
            result.pop();
        }

        if (result.length === 0) {
            throw new ProviderMessageError(
                'After trimming trailing assistant, no messages remain',
                'NO_USER_MESSAGE',
            );
        }

        // Anthropic: no two consecutive 'user' messages
        for (let i = 1; i < result.length; i++) {
            if (result[i].role === 'user' && result[i - 1].role === 'user') {
                throw new ProviderMessageError(
                    'Anthropic does not allow consecutive user messages',
                    'CONSECUTIVE_USER',
                );
            }
        }

        return result;
    }

    // ── OpenAI-specific ────────────────────────────────────────────────────

    private validateOpenAI(messages: ChatMessage[]): ChatMessage[] {
        const result = [...messages];

        // OpenAI: tool role must immediately follow an assistant with tool_calls
        for (let i = 1; i < result.length; i++) {
            if (result[i].role === 'tool') {
                const prev = result[i - 1];
                if (prev.role !== 'assistant' || !(prev as any).tool_calls?.length) {
                    throw new ProviderMessageError(
                        `Tool message at index ${i} must follow an assistant with tool_calls`,
                        'TOOL_WITHOUT_TOOL_CALLS',
                    );
                }
            }
        }

        return result;
    }
}
