// @file: llm-engine/adapters/ui-event-adapter.ts

import { generateUUID, type EventMeta } from '@itookit/common';
import { getEventBus } from '@itookit/llm-kernel';
import type { KernelEventMap } from '@itookit/llm-kernel';
import { OrchestratorEvent, ExecutionNode } from '../core/types';

type KernelEventType = keyof KernelEventMap;

/**
 * UI 事件适配器 — 将 Kernel channel 事件转换为 OrchestratorEvent。
 * Uses channel(sessionId/executionId) for O(1) routing, no manual filtering.
 */
export class UIEventAdapter {
    private nodeMap = new Map<string, ExecutionNode>();

    /**
     * Subscribe to the execution channel and forward converted UI events.
     * Returns a cleanup function that must be called when the session ends.
     */
    bridge(
        sessionId: string,
        onUIEvent: (event: OrchestratorEvent) => void,
    ): () => void {
        const channel = getEventBus().channel(sessionId);

        const unsubscribe = channel.onAny((payload: any, meta: EventMeta) => {
            const uiEvent = this.convertToUIEvent(meta.type as KernelEventType, payload, meta);
            if (uiEvent) onUIEvent(uiEvent);
        });

        return () => {
            unsubscribe();
            this.nodeMap.clear();
        };
    }

    private convertToUIEvent(
        type: KernelEventType,
        payload: any,
        meta: EventMeta,
    ): OrchestratorEvent | null {
        const nodeId = (meta.nodeId as string | undefined) || payload?.nodeId;
        const executionId = (meta.executionId as string | undefined) || meta.channel as string;

        switch (type) {
            case 'node:start':
                return this.handleNodeStart(nodeId, payload);

            case 'stream:thinking':
                return {
                    type: 'node_update',
                    payload: { nodeId: nodeId || '', chunk: payload.delta, field: 'thought' },
                };

            case 'stream:content':
                return {
                    type: 'node_update',
                    payload: {
                        nodeId: nodeId || '',
                        chunk: payload.delta || payload.content,
                        field: 'output',
                    },
                };

            case 'node:update':
                if (payload.status) {
                    return {
                        type: 'node_status',
                        payload: { nodeId: nodeId || '', status: payload.status },
                    };
                }
                return null;

            case 'node:complete':
                return {
                    type: 'node_status',
                    payload: {
                        nodeId: nodeId || '',
                        status: payload.status === 'success' ? 'success' : 'failed',
                        result: payload.output,
                    },
                };

            case 'node:error':
                return {
                    type: 'error',
                    payload: {
                        message: payload.error || payload.message || 'Unknown error',
                        error: new Error(payload.error || payload.message),
                    },
                };

            case 'execution:complete':
                return {
                    type: 'finished',
                    payload: { sessionId: executionId || '', metadata: meta },
                };

            case 'execution:error': {
                const errMsg = payload.error || payload.message || 'Execution failed';
                return {
                    type: 'error',
                    payload: { message: errMsg, error: new Error(errMsg) },
                };
            }

            case 'stream:tool_call':
                return {
                    type: 'node_update',
                    payload: {
                        nodeId: nodeId || '',
                        metaInfo: {
                            toolCall: {
                                name: payload.toolName,
                                args: payload.args,
                                result: payload.result,
                                status: payload.status,
                            },
                        },
                    },
                };

            default:
                return null;
        }
    }

    private handleNodeStart(nodeId: string | undefined, payload: any): OrchestratorEvent {
        const id = nodeId || generateUUID();
        const uiNode: ExecutionNode = {
            id,
            parentId: payload.parentId,
            executorId: payload.executorId || 'unknown',
            executorType: payload.executorType || 'agent',
            name: payload.name || payload.executorId || 'Node',
            status: 'running',
            startTime: Date.now(),
            data: { output: '', thought: '', metaInfo: payload.metaInfo || {} },
            children: [],
        };
        this.nodeMap.set(id, uiNode);
        return { type: 'node_start', payload: { node: uiNode, parentId: payload.parentId } };
    }

    getNode(nodeId: string): ExecutionNode | undefined {
        return this.nodeMap.get(nodeId);
    }

    clear(): void {
        this.nodeMap.clear();
    }
}
