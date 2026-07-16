// executor-chat — minimal ILoop implementation for single-turn chat.
//
// This is the simplest ILoop: no tools, no middleware, single turn.
// It serves as both a reference implementation and the test baseline
// for the ILoop contract.

import type { ILoop, LoopContext, Turn, AgentEvent, Signal } from '@itookit/common';
import { notSupported } from '../core/loop-driver';
import { ulid } from '../persistence/ulid';

export const chatExecutor: ILoop = {
    mode: 'chat',

    async *run(ctx: LoopContext): AsyncGenerator<AgentEvent, Turn[], Signal | undefined> {
        const turnId = ulid();
        const foldStart = performance.now();
        let messages = await ctx.log.fold(ctx.ref);
        console.log('[chat-executor] fold() completed', {
            durationMs: (performance.now() - foldStart).toFixed(1),
            messageCount: messages.length,
            roles: messages.map(m => m.role),
        });

        // Apply historyLength limit (system messages are never counted/truncated)
        if (ctx.historyLength !== undefined && ctx.historyLength !== -1 && ctx.historyLength >= 0) {
            const sys = messages.filter(m => m.role === 'system');
            const rest = messages.filter(m => m.role !== 'system');
            messages = [...sys, ...rest.slice(-ctx.historyLength)];
        }

        // Prepend systemPrompt, deduplicating any system message already in fold result
        const finalMessages = ctx.systemPrompt
            ? [{ role: 'system' as const, content: ctx.systemPrompt }, ...messages.filter(m => m.role !== 'system')]
            : messages;

        yield {
            type: 'turn:start',
            turnId,
            sessionId: ctx.sessionId,
            turn: 1,
        };

        const assistantContent: string[] = [];

        try {
            const llmStart = performance.now();
            console.log('[chat-executor] calling chatStream', {
                connectionId: ctx.connectionId,
                model: ctx.model,
                messageCount: finalMessages.length,
                signalAborted: ctx.signal.aborted,
            });
            const stream = ctx.llm.chatStream(ctx.connectionId ?? 'default', {
                messages: finalMessages,
                model: ctx.model,
                temperature: ctx.temperature,
                maxTokens: ctx.maxTokens,
                thinking: ctx.thinking,
                reasoningEffort: ctx.reasoningEffort as any,
                signal: ctx.signal,
            });

            for await (const chunk of stream) {
                if (ctx.signal.aborted) break;

                const delta = chunk.choices?.[0]?.delta;
                if (!delta) continue;

                if (delta.thinking) {
                    yield { type: 'stream:thinking', delta: delta.thinking };
                }

                if (delta.content) {
                    assistantContent.push(delta.content);
                    yield { type: 'stream:content', delta: delta.content };
                }
            }
            console.log('[chat-executor] chatStream completed', {
                durationMs: (performance.now() - llmStart).toFixed(1),
                contentLen: assistantContent.join('').length,
                chunkCount: assistantContent.length,
            });
        } catch (err) {
            console.error('[chat-executor] chatStream error', err);
            yield {
                type: 'error',
                error: {
                    message: err instanceof Error ? err.message : String(err),
                    code: (err as any)?.code,
                },
            };
        }

        const finalContent = assistantContent.join('');
        const turn: Turn = {
            id: turnId,
            parents: [],
            payload: [
                ...finalMessages,
                { role: 'assistant', content: finalContent },
            ],
            meta: {
                createdAt: Date.now(),
                origin: 'loop',
            },
        };

        yield { type: 'turn:end', turnId, sessionId: ctx.sessionId, turn: 1 };

        return [turn];
    },

    resume(_checkpoint: string): AsyncGenerator<AgentEvent, Turn[], Signal | undefined> {
        notSupported('chat');
    },
};
