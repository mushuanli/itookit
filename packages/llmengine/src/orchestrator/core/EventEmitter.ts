// @file llm-engine/orchestrator/EventEmitter.ts

import { OrchestratorEvent } from '../../core/types';

type EventHandler = (event: OrchestratorEvent) => void;

/**
 * 事件发布器
 * 职责：管理事件订阅和发布
 */
export class SessionEventEmitter {
    private listeners = new Set<EventHandler>();

    subscribe(handler: EventHandler): () => void {
        this.listeners.add(handler);
        return () => this.listeners.delete(handler);
    }

    emit(event: OrchestratorEvent): void {
        this.listeners.forEach(h => h(event));
    }

    clear(): void {
        this.listeners.clear();
    }
}
