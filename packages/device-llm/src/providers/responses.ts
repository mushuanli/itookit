// @file: device-llm/providers/responses.ts

import { BaseProvider } from './base';
import {
    LLMProviderConfig,
    ChatCompletionParams,
    ChatCompletionResponse,
    ChatCompletionChunk,
    ProviderCapabilities,
} from '../types';
import type { ChatMessage, ToolCall } from '@itookit/common';
import { parseEventStream } from '../utils/stream';

/**
 * OpenAI Responses API Provider
 *
 * 新一代接口（DeepSeek / OpenAI 均提供）：
 * - 端点：POST {base}/responses
 * - 请求用 `input` items + `instructions`（替代 messages 数组的 system role）
 * - 响应用 `output[]` items（无 choices），文本在 output[].content[].text
 * - 工具 schema 扁平化（{type,name,description,parameters}，无 function 嵌套）
 * - 流式用语义化 SSE 事件（event: 行 + data: JSON，无 [DONE]）
 *
 * 内部将外部统一的 ChatCompletionParams 双向转换为 Responses 格式。
 */
export class ResponsesProvider extends BaseProvider {
    readonly name = 'responses';

    readonly capabilities: ProviderCapabilities = {
        vision: true,
        audioInput: false,
        audioOutput: false,
        video: false,
        documents: true,
        tools: true,
        parallelTools: true,
        structuredOutput: true,
        jsonMode: true,
        thinking: true,
        codeExecution: false,
        webSearch: true,
        computerUse: false,
        mcp: false,
        caching: true,
        batch: false,
        streaming: true,
    };

    constructor(config: LLMProviderConfig) {
        super(config);
        if (!this.baseURL) {
            this.baseURL = 'https://api.deepseek.com';
        }
    }

    protected getProviderFormat(): 'openai' | 'anthropic' | 'gemini' {
        return 'openai';
    }

    private resolveResponsesUrl(): string {
        return this.resolveEndpointUrl(this.config.defaultPath ?? '/responses');
    }

    // ============== 主入口 ==============

    async create(params: ChatCompletionParams): Promise<ChatCompletionResponse> {
        this.validateParams(params);

        const url = this.resolveResponsesUrl();
        const body = this.buildResponsesBody(params);

        const response = await this.fetchJSON<any>(url, {
            method: 'POST',
            headers: this.buildHeaders(),
            body: JSON.stringify(body),
            signal: params.signal,
        });

        return this.normalizeResponse(response);
    }

    async *stream(params: ChatCompletionParams): AsyncGenerator<ChatCompletionChunk> {
        this.validateParams(params);

        const url = this.resolveResponsesUrl();
        const body = this.buildResponsesBody({ ...params, stream: true });

        const raw = await this.fetchStream(url, {
            method: 'POST',
            headers: this.buildHeaders(),
            body: JSON.stringify(body),
            signal: params.signal,
        });

        const aggregator = new StreamAggregator();
        for await (const { event, data } of parseEventStream(raw)) {
            const payload = this.safeJson(data);
            if (!payload) continue;

            // 终态事件 — 刷新 usage 后结束（内容已逐 delta 发出，此处只补 usage/finish）
            if (event === 'response.completed' || event === 'response.incomplete' || event === 'response.failed') {
                if (payload.usage) aggregator.usage = this.normalizeUsage(payload.usage);
                const final = aggregator.finalize(event === 'response.failed');
                if (final) yield final;
                break;
            }

            const chunk = this.handleStreamEvent(event, payload, aggregator);
            if (chunk) yield chunk;
        }
    }

    // ============== 请求构建 ==============

    private buildResponsesBody(params: ChatCompletionParams): Record<string, any> {
        const { instructions, input } = this.convertMessagesToInput(params.messages);
        const body: Record<string, any> = {
            model: this.getModel(params),
            input,
        };
        if (instructions) body.instructions = instructions;
        if (params.stream) body.stream = true;
        if (params.temperature !== undefined) body.temperature = params.temperature;
        if (params.maxTokens !== undefined) body.max_output_tokens = params.maxTokens;
        if (params.topP !== undefined) body.top_p = params.topP;
        if (params.stop !== undefined) body.stop = params.stop;
        if (params.user !== undefined) body.user = params.user;
        if (params.metadata) body.metadata = params.metadata;

        if (params.tools && params.tools.length > 0) {
            body.tools = this.convertToolsToFlat(params.tools);
            if (params.toolChoice) body.tool_choice = params.toolChoice;
            if (params.parallelToolCalls !== undefined) body.parallel_tool_calls = params.parallelToolCalls;
        }
        if (params.responseFormat) {
            body.text = this.convertResponseFormat(params.responseFormat);
        }

        return body;
    }

    /**
     * 将统一 ChatMessage[] 转为 Responses input items。
     * - system 消息 → 提取为 instructions（顶层字段）
     * - user/assistant → { type: 'message', role, content }
     * - tool 结果 → { type: 'function_call_output', call_id, output }
     * - assistant 历史 tool_calls → { type: 'function_call', call_id, name, arguments }
     */
    private convertMessagesToInput(messages: ChatMessage[]): { instructions: string; input: string | any[] } {
        const instructions = messages
            .filter(m => m.role === 'system')
            .map(m => typeof m.content === 'string' ? m.content : '')
            .filter(Boolean)
            .join('\n');

        const items: any[] = [];
        for (const msg of messages) {
            if (msg.role === 'system') continue;

            if (msg.role === 'tool') {
                items.push({
                    type: 'function_call_output',
                    call_id: msg.tool_call_id ?? '',
                    output: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
                });
                continue;
            }

            if (msg.role === 'assistant' && msg.tool_calls?.length) {
                for (const call of msg.tool_calls) {
                    items.push({
                        type: 'function_call',
                        call_id: call.id,
                        name: call.function?.name ?? '',
                        arguments: call.function?.arguments ?? '',
                    });
                }
                continue;
            }

            items.push({
                type: 'message',
                role: msg.role,
                content: this.convertContent(msg.content),
            });
        }

        // 单条纯文本 user 消息可直接传字符串 input；否则保留 item 数组。
        const singleUser = items.length === 1 && items[0].type === 'message' && items[0].role === 'user';
        const singleText = singleUser && Array.isArray(items[0].content)
            && items[0].content.length === 1 && items[0].content[0].type === 'input_text';
        const input = singleText
            ? (items[0].content as any[])[0].text
            : items;
        return { instructions, input };
    }

    private convertContent(content: unknown): any[] {
        if (typeof content === 'string') {
            return content ? [{ type: 'input_text', text: content }] : [];
        }
        if (Array.isArray(content)) {
            return content.map(part => {
                const p = part as any;
                if (p.type === 'image_url') {
                    return { type: 'input_image', image_url: p.image_url };
                }
                return { type: 'input_text', text: p.text ?? '' };
            });
        }
        return [];
    }

    /** 统一工具定义（嵌套 function）→ Responses 扁平 schema。 */
    private convertToolsToFlat(tools: any[]): any[] {
        return tools.map(tool => {
            const fn = tool.function ?? tool;
            const flat: Record<string, unknown> = {
                type: tool.type ?? 'function',
                name: fn.name,
                description: fn.description,
                parameters: fn.parameters,
            };
            if (fn.strict !== undefined) flat.strict = fn.strict;
            return flat;
        });
    }

    private convertResponseFormat(format: any): any {
        if (format.type === 'json_schema') {
            return {
                format: { type: 'json_schema', name: format.json_schema?.name, schema: format.json_schema?.schema },
            };
        }
        return { format: { type: format.type === 'json_object' ? 'json_object' : 'text' } };
    }

    // ============== 响应标准化 ==============

    private normalizeResponse(response: any): ChatCompletionResponse {
        const output: any[] = response.output ?? [];
        const text = collectText(output);
        const toolCalls = collectToolCalls(output);
        const thinking = collectReasoning(output);

        return {
            id: response.id,
            object: response.object ?? 'response',
            created: response.created_at,
            model: response.model,
            choices: [{
                index: 0,
                message: {
                    role: 'assistant',
                    content: text,
                    ...(thinking ? { thinking } : {}),
                    ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
                },
                finish_reason: this.mapFinishReason(response.status),
            }],
            usage: response.usage ? this.normalizeUsage(response.usage) : undefined,
        };
    }

    private mapFinishReason(status: string): any {
        switch (status) {
            case 'completed': return 'stop';
            case 'incomplete': return 'length';
            case 'failed': return 'error';
            default: return null;
        }
    }

    private normalizeUsage(usage: any): any {
        return {
            prompt_tokens: usage.input_tokens,
            completion_tokens: usage.output_tokens,
            total_tokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
            cached_tokens: usage.input_tokens_details?.cached_tokens,
            thinking_tokens: usage.output_tokens_details?.reasoning_tokens,
            details: {
                reasoning_tokens: usage.output_tokens_details?.reasoning_tokens,
            },
        };
    }

    // ============== 流式事件处理 ==============

    private handleStreamEvent(
        event: string | undefined,
        payload: any,
        agg: StreamAggregator,
    ): ChatCompletionChunk | undefined {
        const delta: any = {};
        let finish: any = null;

        switch (event) {
            case 'response.output_text.delta':
                agg.text += payload.delta ?? '';
                delta.content = payload.delta;
                break;
            case 'response.reasoning_text.delta':
                agg.thinking += payload.delta ?? '';
                delta.thinking = payload.delta;
                break;
            case 'response.function_call_arguments.delta':
                agg.accumulateTool(payload.item_id, payload.delta);
                break;
            case 'response.function_call_arguments.done':
                delta.tool_calls = agg.flushTool(payload.item_id);
                break;
            case 'response.output_item.done':
                if (payload.item?.type === 'function_call') {
                    delta.tool_calls = [{
                        id: payload.item.call_id,
                        type: 'function',
                        function: {
                            name: payload.item.name,
                            arguments: payload.item.arguments ?? '',
                        },
                    }];
                }
                break;
            case 'response.completed':
                if (payload.usage) agg.usage = this.normalizeUsage(payload.usage);
                finish = 'stop';
                break;
            case 'response.incomplete':
                finish = 'length';
                break;
            default:
                return undefined;
        }

        if (delta.content === undefined && delta.thinking === undefined
            && delta.tool_calls === undefined && finish === null) {
            return undefined;
        }

        return {
            id: payload.id ?? agg.id,
            object: 'chat.completion.chunk',
            choices: [{
                index: 0,
                delta,
                finish_reason: finish,
            }],
            usage: agg.usage,
        };
    }

    private safeJson(data: string): any | undefined {
        try {
            return JSON.parse(data);
        } catch {
            return undefined;
        }
    }
}

// ─── 流式聚合辅助 ────────────────────────────────────────────────────────────

class StreamAggregator {
    id?: string;
    text = '';
    thinking = '';
    usage?: any;
    private toolArgs = new Map<string, string>();

    accumulateTool(itemId: string | undefined, delta: string): void {
        if (!itemId) return;
        this.toolArgs.set(itemId, (this.toolArgs.get(itemId) ?? '') + delta);
    }

    flushTool(itemId: string | undefined): Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> | undefined {
        if (!itemId || !this.toolArgs.has(itemId)) return undefined;
        const argumentsStr = this.toolArgs.get(itemId)!;
        this.toolArgs.delete(itemId);
        return [{ id: itemId, type: 'function', function: { name: '', arguments: argumentsStr } }];
    }

    finalize(failed: boolean): ChatCompletionChunk | undefined {
        // 终态 chunk：内容已通过 output_text.delta 逐条发出，这里只补 usage 与 finish_reason。
        return {
            id: this.id,
            object: 'chat.completion.chunk',
            choices: [{
                index: 0,
                delta: {},
                finish_reason: failed ? 'error' : 'stop',
            }],
            usage: this.usage,
        };
    }
}

// ─── output[] 提取辅助 ───────────────────────────────────────────────────────

function collectText(output: any[]): string {
    const parts: string[] = [];
    for (const item of output) {
        if (item.type === 'message') {
            for (const content of item.content ?? []) {
                if (content.type === 'output_text' && typeof content.text === 'string') {
                    parts.push(content.text);
                }
            }
        }
    }
    return parts.join('');
}

function collectToolCalls(output: any[]): ToolCall[] {
    const calls: ToolCall[] = [];
    for (const item of output) {
        if (item.type === 'function_call') {
            calls.push({
                id: item.call_id,
                type: 'function',
                function: {
                    name: item.name,
                    arguments: item.arguments ?? '',
                },
            });
        }
    }
    return calls;
}

function collectReasoning(output: any[]): string | undefined {
    const parts: string[] = [];
    for (const item of output) {
        if (item.type === 'reasoning') {
            for (const content of item.content ?? []) {
                if (typeof content.text === 'string') parts.push(content.text);
            }
        }
    }
    return parts.length ? parts.join('') : undefined;
}
