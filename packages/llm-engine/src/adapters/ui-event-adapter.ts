// @file: llm-engine/adapters/ui-event-adapter.ts

import { generateUUID } from '@itookit/common';
import { KernelEvent, getEventBus } from '@itookit/llm-kernel';
import { OrchestratorEvent, ExecutionNode } from '../core/types';

/**
 * UI 事件适配器
 * 将 Kernel 事件转换为 UI 事件
 */
export class UIEventAdapter {
    private nodeMap = new Map<string, ExecutionNode>();

    /**
     * 桥接 Kernel 事件到 UI 事件
     */
    bridge(
        sessionId: string,
        onUIEvent: (event: OrchestratorEvent) => void
    ): () => void {
        const eventBus = getEventBus();

        const handler = (kernelEvent: KernelEvent) => {
            // 只处理当前会话的事件
            if (kernelEvent.executionId !== sessionId) return;

            const uiEvent = this.convertToUIEvent(kernelEvent);
            if (uiEvent) {
                onUIEvent(uiEvent);
            }
        };

        // 订阅相关事件
        const unsubscribers = [
            eventBus.on('node:start', handler),
            eventBus.on('node:update', handler),
            eventBus.on('node:complete', handler),
            eventBus.on('node:error', handler),
            eventBus.on('stream:thinking', handler),
            eventBus.on('stream:content', handler),
            eventBus.on('stream:tool_call', handler),
            eventBus.on('execution:complete', handler),
            eventBus.on('execution:error', handler)
        ];

        return () => {
            unsubscribers.forEach(unsub => unsub());
            this.nodeMap.clear();
        };
    }

    /**
     * 转换 Kernel 事件为 UI 事件
     */
    private convertToUIEvent(kernelEvent: KernelEvent): OrchestratorEvent | null {
        const { type, nodeId, payload, executionId, metadata } = kernelEvent;

        switch (type) {
            case 'node:start':
                return this.handleNodeStart(nodeId, payload);

            case 'stream:thinking':
                return {
                    type: 'node_update',
                    payload: {
                        nodeId: nodeId || '',
                        chunk: payload.delta,
                        field: 'thought'
                    }
                };

            case 'stream:content':
                return {
                    type: 'node_update',
                    payload: {
                        nodeId: nodeId || payload?.nodeId || '',  // 保留 fallback
                        chunk: payload.delta || payload.content,  // 保留兼容性
                        field: 'output'
                    }
                };

            case 'node:update':
                if (payload.status) {
                    return {
                        type: 'node_status',
                        payload: {
                            nodeId: nodeId || '',
                            status: payload.status
                        }
                    };
                }
                return null;

            case 'node:complete':
                return {
                    type: 'node_status',
                    payload: {
                        nodeId: nodeId || '',
                        status: payload.status === 'success' ? 'success' : 'failed',
                        result: payload.output
                    }
                };

            case 'node:error':
                return {
                    type: 'error',
                    payload: {
                        message: payload.error || payload.message || 'Unknown error',
                        error: new Error(payload.error || payload.message)
                    }
                };

            case 'execution:complete':
                return {
                    type: 'finished',
                    payload: { sessionId: executionId, metadata: metadata }
                };

            case 'execution:error':
                return {
                    type: 'error',
                    payload: {
                        message: payload.message || 'Execution failed',
                        error: new Error(payload.message)
                    }
                };

            case 'stream:tool_call':
                // 可以扩展为专门的工具调用事件
                return {
                    type: 'node_update',
                    payload: {
                        nodeId: nodeId || '',
                        metaInfo: {
                            toolCall: {
                                name: payload.toolName,
                                args: payload.args,
                                result: payload.result,
                                status: payload.status
                            }
                        }
                    }
                };

            default:
                return null;
        }
    }

    /**
     * 处理节点开始事件
     */
    private handleNodeStart(nodeId: string | undefined, payload: any): OrchestratorEvent {
        const id = nodeId || generateUUID();

        // 创建 UI 节点
        const uiNode: ExecutionNode = {
            id,
            parentId: payload.parentId,
            executorId: payload.executorId || 'unknown',
            executorType: payload.executorType || 'agent',
            name: payload.name || payload.executorId || 'Node',
            status: 'running',
            startTime: Date.now(),
            data: {
                output: '',
                thought: '',
                metaInfo: payload.metaInfo || {}
            },
            children: []
        };

        this.nodeMap.set(id, uiNode);

        return {
            type: 'node_start',
            payload: { node: uiNode, parentId: payload.parentId }
        };
    }

    /**
     * 获取节点
     */
    getNode(nodeId: string): ExecutionNode | undefined {
        return this.nodeMap.get(nodeId);
    }

    /**
     * 清理
     */
    clear(): void {
        this.nodeMap.clear();
    }
}
