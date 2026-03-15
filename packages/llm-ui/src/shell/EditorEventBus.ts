// @file: llm-ui/shell/EditorEventBus.ts

import type { IEditorEventBus, EditorBusEvents, EditorEventKey } from '../domain/events';

type EventCallback<K extends EditorEventKey> = (payload: EditorBusEvents[K]) => void;

/**
 * 编辑器内部事件总线 — 实例级（非全局单例）
 */
export class EditorEventBus implements IEditorEventBus {
    private handlers = new Map<string, Set<Function>>();

    on<K extends EditorEventKey>(event: K, callback: EventCallback<K>): () => void {
        if (!this.handlers.has(event)) {
            this.handlers.set(event, new Set());
        }
        this.handlers.get(event)!.add(callback);
        return () => { this.handlers.get(event)?.delete(callback); };
    }

    emit<K extends EditorEventKey>(event: K, payload: EditorBusEvents[K]): void {
        this.handlers.get(event)?.forEach(cb => {
            try {
                (cb as EventCallback<K>)(payload);
            } catch (e) {
                console.error(`[EditorEventBus] Error in "${event}":`, e);
            }
        });
    }

    once<K extends EditorEventKey>(event: K, callback: EventCallback<K>): () => void {
        const unsub = this.on(event, (payload) => {
            unsub();
            callback(payload);
        });
        return unsub;
    }

    destroy(): void {
        this.handlers.clear();
    }
}
