import type {
    AgentEvent,
    AssistantMessage,
    ChatCompletionChunk,
    ChatCompletionParams,
    ChatCompletionResponse,
    FinishReason,
    ILLMService,
    TokenUsage,
    ToolCall,
} from '@itookit/common';
import type { EffectAdapter, EffectExecutionContext, EffectReconcileResult } from '@itookit/harness';
import { expandMessagesAttachments } from '@itookit/device-llm';
import { assertCapabilityGrant, resolveCapability, type CapabilitySource } from '../ports/capabilities';

export interface LlmChatEffectRequest {
    resourceHandleId: string;
    connectionId: string;
    request: Omit<ChatCompletionParams, 'signal'>;
    recovery?: 'retry' | 'indeterminate';
}

export class LlmChatEffectAdapter implements EffectAdapter<LlmChatEffectRequest, ChatCompletionResponse> {
    readonly kind = 'llm.chat';
    readonly version = '1';

    constructor(private readonly service: CapabilitySource<ILLMService>) {}

    async execute(
        request: LlmChatEffectRequest,
        context: EffectExecutionContext,
    ): Promise<ChatCompletionResponse> {
        assertCapabilityGrant(context, request.resourceHandleId, 'llm');
        if (!request.connectionId.trim()) throw new Error('LLM connection id is required');
        const service = await resolveCapability(this.service, context);
        const params: ChatCompletionParams = { ...request.request, signal: context.abortSignal };
        const emit = makeEmitter(context);

        if (request.request.stream === false) {
            const response = await service.chat(request.connectionId, params);
            await emitFinalContent(emit, response);
            return response;
        }
        return streamChat(service, request.connectionId, params, emit);
    }

    async reconcile(request: LlmChatEffectRequest): Promise<EffectReconcileResult<ChatCompletionResponse>> {
        if (request.recovery === 'retry') return { status: 'retry' };
        return {
            status: 'indeterminate',
            error: { message: 'LLM request outcome cannot be reconciled after worker loss', code: 'LLM_INDETERMINATE' },
        };
    }
}

export async function prepareLlmChatEffectRequest(
    connectionId: string,
    resourceHandleId: string,
    request: ChatCompletionParams,
    recovery?: LlmChatEffectRequest['recovery'],
): Promise<LlmChatEffectRequest> {
    const { signal: _signal, ...durable } = request;
    return {
        connectionId,
        resourceHandleId,
        request: {
            ...durable,
            messages: await expandMessagesAttachments(request.messages),
        },
        recovery,
    };
}

// ─── Streaming helpers ─────────────────────────────────────────────────────────

/** 流式事件批量窗口（ms）。合并 LLM 高频 chunk 为低频事件写入，缓解事件日志 O(n²) 轮询。 */
const STREAM_BATCH_MS = 40;

function makeEmitter(context: EffectExecutionContext): (event: AgentEvent) => Promise<void> {
    const emit = context.emit;
    return async (event: AgentEvent): Promise<void> => {
        await emit?.({ type: 'agent.event', payload: event });
    };
}

/** 非流式（stream=false）：一次性把完整 thinking/content 写入事件日志，渲染统一归 effect 层。 */
async function emitFinalContent(
    emit: (event: AgentEvent) => Promise<void>,
    response: ChatCompletionResponse,
): Promise<void> {
    const message = response.choices[0]?.message;
    if (message?.thinking) await emit({ type: 'stream:thinking', delta: message.thinking });
    if (message?.content) await emit({ type: 'stream:content', delta: message.content });
}

async function streamChat(
    service: ILLMService,
    connectionId: string,
    params: ChatCompletionParams,
    emit: (event: AgentEvent) => Promise<void>,
): Promise<ChatCompletionResponse> {
    const batcher = new DeltaBatcher(emit);
    const aggregator = new ResponseAggregator();
    try {
        for await (const chunk of service.chatStream(connectionId, params)) {
            const delta = chunk.choices?.[0]?.delta;
            if (delta?.thinking) {
                aggregator.appendThinking(delta.thinking);
                batcher.push('stream:thinking', delta.thinking);
            }
            if (delta?.content) {
                aggregator.appendContent(delta.content);
                batcher.push('stream:content', delta.content);
            }
            if (delta?.tool_calls) aggregator.appendToolCalls(delta.tool_calls);
            aggregator.observe(chunk);
        }
        await batcher.flush();
        return aggregator.build();
    } catch (error) {
        // Flush partial output so the UI shows what was generated before abort/failure.
        await batcher.flush();
        throw error;
    }
}

class DeltaBatcher {
    private pending: Array<{ type: 'stream:thinking' | 'stream:content'; delta: string }> = [];
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly emit: (event: AgentEvent) => Promise<void>) {}

    push(type: 'stream:thinking' | 'stream:content', delta: string): void {
        this.pending.push({ type, delta });
        if (this.timer) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            void this.flush();
        }, STREAM_BATCH_MS);
    }

    async flush(): Promise<void> {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        const batch = this.pending;
        this.pending = [];
        for (const item of batch) {
            await this.emit({ type: item.type, delta: item.delta });
        }
    }
}

class ResponseAggregator {
    private content = '';
    private thinking = '';
    private readonly toolCallByIndex = new Map<number, ToolCall>();
    private usage?: TokenUsage;
    private finishFromUsage: FinishReason = null;
    private lastFinishReason: FinishReason = null;
    private id?: string;
    private model?: string;

    appendContent(delta: string): void { this.content += delta; }
    appendThinking(delta: string): void { this.thinking += delta; }

    appendToolCalls(calls: ChatCompletionChunk['choices'][number]['delta']['tool_calls']): void {
        for (const call of calls ?? []) {
            const index = call.index ?? 0;
            let entry = this.toolCallByIndex.get(index);
            if (!entry) {
                entry = { id: call.id ?? '', type: (call.type as ToolCall['type']) ?? 'function', function: { name: '', arguments: '' } };
                this.toolCallByIndex.set(index, entry);
            }
            if (call.id) entry.id = call.id;
            const fn = entry.function ?? { name: '', arguments: '' };
            if (call.function?.name) fn.name += call.function.name;
            if (call.function?.arguments) fn.arguments += call.function.arguments;
            entry.function = fn;
        }
    }

    observe(chunk: ChatCompletionChunk): void {
        if (!this.id && chunk.id) this.id = chunk.id;
        if (!this.model && chunk.model) this.model = chunk.model;
        if (chunk.usage) this.usage = chunk.usage;
        const reason = chunk.choices?.[0]?.finish_reason;
        if (!reason) return;
        // Anthropic: message_delta carries the real finish_reason + usage; message_stop
        // appends a synthetic 'stop' that would mask 'tool_use'. Trust the usage chunk.
        if (chunk.usage) this.finishFromUsage = reason;
        this.lastFinishReason = reason;
    }

    build(): ChatCompletionResponse {
        const toolCalls = this.toolCallByIndex.size
            ? Array.from(this.toolCallByIndex.values())
            : undefined;
        const message: AssistantMessage = {
            role: 'assistant',
            content: this.content || '',
            ...(this.thinking ? { thinking: this.thinking } : {}),
            ...(toolCalls ? { tool_calls: toolCalls } : {}),
        };
        return {
            ...(this.id ? { id: this.id } : {}),
            ...(this.model ? { model: this.model } : {}),
            choices: [{
                index: 0,
                message,
                finish_reason: this.finishFromUsage ?? this.lastFinishReason,
            }],
            ...(this.usage ? { usage: this.usage } : {}),
        };
    }
}
