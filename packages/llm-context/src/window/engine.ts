import type { ChatMessage } from '../domain/message';
import type { ContextCompactionPolicy } from '../domain/policy';
import type { IContextEngine, WindowSelection } from '../domain/durable';
import { compactMessages, validateContextCompaction } from './compact-messages';
import { ProviderMessageAdapter } from '../assembly/provider-message-adapter';

export class ContextError extends Error {
    constructor(public readonly code: string, message: string) { super(message); this.name = 'ContextError'; }
}

/** UTF-8 bytes deliberately overestimate text tokens when no tokenizer is available. */
export function estimateRequestTokens(request: Record<string, unknown>): number {
    return new TextEncoder().encode(JSON.stringify(request)).byteLength;
}

export function createContextEngine(): IContextEngine { return { select }; }

function select(messages: ChatMessage[], request: Record<string, unknown>, policy?: ContextCompactionPolicy): WindowSelection {
    validateContextCompaction(policy);
    new ProviderMessageAdapter().validate(messages);
    const limit = policy?.maxInputTokens ?? 64_000;
    requirePositive(limit);
    let selected = compactMessages(messages, policy ?? { maxMessages: 100, keepRecent: 20 });
    while (estimateRequestTokens({ ...request, messages: selected }) > limit) {
        const next = removeOldestGroup(selected);
        if (next.length === selected.length) throw new ContextError('CONTEXT_REQUIRED_INPUT_TOO_LARGE', 'Required context exceeds input budget');
        selected = next;
    }
    new ProviderMessageAdapter().validate(selected);
    const included = new Set(selected);
    return { messages: structuredClone(selected), removed: messages.filter(message => !included.has(message)),
        explanation: { strategy: selected.length === messages.length ? 'retain' : 'prune',
            inputTokens: estimateRequestTokens({ ...request, messages: selected }), estimated: true,
            removedMessages: messages.length - selected.length } };
}

function removeOldestGroup(messages: ChatMessage[]): ChatMessage[] {
    let lastUser = -1;
    messages.forEach((message, index) => { if (message.role === 'user') lastUser = index; });
    const groups: number[][] = [];
    for (let i = 0; i < messages.length; i++) {
        const group = [i];
        if (messages[i].tool_calls?.length) while (messages[i + 1]?.role === 'tool') group.push(++i);
        groups.push(group);
    }
    const group = groups.find(indices => !indices.includes(lastUser) && !indices.includes(messages.length - 1)
        && indices.every(i => !['system', 'developer'].includes(messages[i].role) && !messages[i].tags?.includes('context-objective')));
    return group ? messages.filter((_, index) => !group.includes(index)) : messages;
}

export function requirePositive(value: number): void {
    if (!Number.isSafeInteger(value) || value < 1) throw new ContextError('CONTEXT_INVALID_LIMIT', 'Context limit must be a positive safe integer');
}
