// @file: llm-kernel/core/event-bus.ts
// Replaces the hand-rolled EventBus with the shared core from @itookit/common.

import { EventBus, type IEventChannel, type IEventBus } from '@itookit/common';
export { EventBus };

// ── Kernel event type catalogue ──────────────────────────────────────────────

export type KernelEventType =
    | 'execution:start'
    | 'execution:progress'
    | 'execution:complete'
    | 'execution:error'
    | 'execution:cancel'
    | 'node:start'
    | 'node:update'
    | 'node:complete'
    | 'node:error'
    | 'stream:thinking'
    | 'stream:content'
    | 'stream:tool_call'
    | 'interaction:request_input'
    | 'interaction:confirm'
    | 'state:changed';

/** Per-event payload shapes. */
export interface KernelEventMap {
    'execution:start':    { executionId: string; [k: string]: unknown };
    'execution:progress': { executionId: string; progress?: number; [k: string]: unknown };
    'execution:complete': { executionId: string; result?: unknown; [k: string]: unknown };
    'execution:error':    { executionId: string; code: string; message: string; stack?: string; [k: string]: unknown };
    'execution:cancel':   { executionId: string; [k: string]: unknown };
    'node:start':         { nodeId?: string; executionId?: string; executorId?: string; executorType?: string; name?: string; input?: unknown; [k: string]: unknown };
    'node:update':        { nodeId?: string; status?: string; thought?: string; output?: string; [k: string]: unknown };
    'node:complete':      { nodeId?: string; executionId?: string; executorId?: string; status?: string; output?: unknown; [k: string]: unknown };
    'node:error':         { nodeId?: string; error?: string; message?: string; executionId?: string; [k: string]: unknown };
    'stream:thinking':    { delta: string; nodeId?: string };
    'stream:content':     { delta: string; content?: string; nodeId?: string };
    'stream:tool_call':   { nodeId?: string; [k: string]: unknown };
    'interaction:request_input': { prompt?: string; [k: string]: unknown };
    'interaction:confirm':       { message?: string; [k: string]: unknown };
    'state:changed':      { from: string; to: string; executionId: string; [k: string]: unknown };
}

/** Envelope type used by the Worker protocol (postMessage serialization). */
export interface KernelEvent<T = unknown> {
    type: KernelEventType;
    executionId: string;
    nodeId?: string;
    timestamp: number;
    payload: T;
}

export type KernelEventBus = IEventBus<KernelEventMap>;
export type KernelEventChannel = IEventChannel<KernelEventMap>;

/**
 * Scoped event bus — alias kept for ExecutionContext compatibility.
 * Prefer IEventChannel<KernelEventMap> in new code.
 */
export type IScopedEventBus = KernelEventChannel;

// Singleton
let globalEventBus: EventBus<KernelEventMap> | null = null;

export function getEventBus(): EventBus<KernelEventMap> {
    if (!globalEventBus) {
        globalEventBus = new EventBus<KernelEventMap>();
    }
    return globalEventBus;
}
