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
    IDeviceDriver,
    DeviceContext,
} from '@itookit/common';
import { LLM_IOCTL } from '@itookit/device-llm';

const BASE_CTX: DeviceContext = { nodeId: 'llm', name: 'llm' };

export class LLMServiceAdapter implements ILLMService {
    constructor(private readonly driver: IDeviceDriver) {}

    async chat(connectionId: string, request: ChatCompletionParams): Promise<ChatCompletionResponse> {
        const response = await this.driver.ioctl?.(
            { ...BASE_CTX, sessionId: connectionId },
            LLM_IOCTL.CHAT_SYNC,
            { connectionId, ...request },
        );
        return response as ChatCompletionResponse;
    }

    async *chatStream(connectionId: string, request: ChatCompletionParams): AsyncIterable<ChatCompletionChunk> {
        const sessionId = await this.driver.open?.(BASE_CTX, { connectionId }) ?? connectionId;
        const ctx: DeviceContext = { ...BASE_CTX, sessionId };

        // Write the request to start generation
        await this.driver.write(ctx, JSON.stringify(request));

        if (!this.driver.readStream) throw new Error('LLM driver does not support streaming');
        for await (const chunk of this.driver.readStream(ctx)) {
            if (typeof chunk === 'string') {
                yield JSON.parse(chunk) as ChatCompletionChunk;
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

    estimateTokens(_connectionId: string, text: string): number {
        // Simple character-based approximation (4 chars per token)
        return Math.ceil(text.length / 4);
    }
}
