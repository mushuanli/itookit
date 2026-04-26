// @file: llm-harness/src/adapters/llm-service-adapter.ts
// LLMServiceAdapter — 将 LLMDeviceDriver 的设备接口适配为简洁的 ILLMService。
//
// AgentLoopExecutor 通过 ILLMService 调用 LLM，
// 不直接感知 device driver 的 open/write/readStream 模式。

import type {
    ILLMService,
    ChatCompletionParams,
    ChatCompletionResponse,
    ChatCompletionChunk,
    ConnectionMeta,
    LLMProvider,
    IDeviceDriver,
    DeviceContext,
} from '@itookit/common';
import { LLM_IOCTL } from '@itookit/device-llm';

const BASE_CTX: DeviceContext = { nodeId: 'llm', name: 'llm' };

export class LLMServiceAdapter implements ILLMService {
    constructor(private readonly driver: IDeviceDriver) {}

    async chat(connectionId: string, request: ChatCompletionParams): Promise<ChatCompletionResponse> {
        // Use streaming internally to support APIs that only respond via SSE.
        // CHAT_SYNC (stream:false) hangs on some proxy endpoints; collecting
        // streaming chunks is universally compatible.
        const contentParts: string[] = [];
        const toolCallMap = new Map<number, { id: string; name: string; args: string }>();
        let finishReason = 'stop';
        let usage: ChatCompletionResponse['usage'];
        let model = '';

        for await (const chunk of this.chatStream(connectionId, request)) {
            model = model || chunk.model || '';
            const delta = chunk.choices?.[0]?.delta;
            if (delta?.content) contentParts.push(delta.content);
            if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                    const idx = tc.index ?? 0;
                    if (!toolCallMap.has(idx)) {
                        toolCallMap.set(idx, { id: tc.id ?? '', name: tc.function?.name ?? '', args: '' });
                    }
                    if (tc.function?.arguments) {
                        toolCallMap.get(idx)!.args += tc.function.arguments;
                    }
                }
            }
            if (chunk.choices?.[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason;
            if (chunk.usage) usage = chunk.usage;
        }

        const toolCalls = toolCallMap.size > 0
            ? [...toolCallMap.entries()].sort(([a], [b]) => a - b).map(([, tc]) => ({
                id: tc.id, type: 'function' as const,
                function: { name: tc.name, arguments: tc.args },
            }))
            : undefined;

        return {
            id: '',
            object: 'chat.completion',
            created: Date.now(),
            model,
            choices: [{
                index: 0,
                message: { role: 'assistant', content: contentParts.join(''), tool_calls: toolCalls },
                finish_reason: finishReason,
            }],
            usage,
        } as unknown as ChatCompletionResponse;
    }

    async *chatStream(connectionId: string, request: ChatCompletionParams): AsyncIterable<ChatCompletionChunk> {
        const sessionId = await this.driver.open?.(BASE_CTX, { connectionId }) ?? connectionId;
        const ctx: DeviceContext = { ...BASE_CTX, sessionId };

        await this.driver.write(ctx, JSON.stringify(request));

        if (!this.driver.readStream) throw new Error('LLM driver does not support streaming');
        for await (const chunk of this.driver.readStream(ctx)) {
            if (typeof chunk === 'string') {
                // driver.readStream already parses SSE and yields plain-text delta content.
                // Wrap it as a ChatCompletionChunk so callers can access delta.content uniformly.
                yield {
                    id: '', object: 'chat.completion.chunk', created: 0, model: '',
                    choices: [{ index: 0, delta: { content: chunk, role: 'assistant' }, finish_reason: null }],
                } as unknown as ChatCompletionChunk;
            }
        }
        await this.driver.close?.(ctx);
    }

    abort(connectionId: string): void {
        this.driver.ioctl?.(
            { ...BASE_CTX, sessionId: connectionId },
            LLM_IOCTL.ABORT,
        ).catch(() => {});
    }

    async getConnection(connectionId: string): Promise<ConnectionMeta | undefined> {
        const result = await this.driver.ioctl?.(BASE_CTX, LLM_IOCTL.GET_CONNECTION_META, connectionId);
        return (result as ConnectionMeta | null) ?? undefined;
    }

    async getDefaultConnection(): Promise<ConnectionMeta | null> {
        const result = await this.driver.ioctl?.(BASE_CTX, LLM_IOCTL.GET_DEFAULT_CONNECTION);
        return (result as ConnectionMeta | null) ?? null;
    }

    async listConnections(): Promise<ConnectionMeta[]> {
        const result = await this.driver.ioctl?.(BASE_CTX, LLM_IOCTL.LIST_CONNECTIONS);
        return (result as ConnectionMeta[]) ?? [];
    }

    async getProvider(providerId: string): Promise<LLMProvider | undefined> {
        const result = await this.driver.ioctl?.(BASE_CTX, LLM_IOCTL.GET_PROVIDER, providerId);
        return (result as LLMProvider | null) ?? undefined;
    }

    estimateTokens(_connectionId: string, text: string): number {
        // Simple character-based approximation (4 chars per token)
        return Math.ceil(text.length / 4);
    }
}
