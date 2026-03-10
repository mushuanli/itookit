// @file: llm-ui/core/EditorEventBus.ts

/**
 * 类型安全的编辑器内部事件总线
 *
 * 每个 LLMWorkspaceEditor 实例有自己的 EventBus（非全局单例）。
 * 只用于「多对多」或「跨层级」通信，「父子」通信仍用回调。
 */

export interface EditorBusEvents {
    // 分支操作
    'branch:create': { sourceNodeId: string };
    'branch:switch': { branchName: string };
    'branch:switchById': { headNodeId: string };
    'branch:rename': { oldName: string; newName: string };
    'branch:delete': { branchName: string };

    // 导航操作
    'nav:scrollTo': { sessionId: string };
    'nav:toggleFold': { sessionId: string };
    'nav:foldAll': {};
    'nav:unfoldAll': {};

    // 批量操作
    'batch:delete': { ids: string[] };
    'batch:copy': { ids: string[] };

    // 内容操作
    'content:copy': { sessionId: string };

    // 状态变化通知
    'state:collapseChanged': { states: Record<string, boolean> };
    'state:inputChanged': {};
}

type EventKey = keyof EditorBusEvents;
type EventPayload<K extends EventKey> = EditorBusEvents[K];
type EventCallback<K extends EventKey> = (payload: EventPayload<K>) => void;

export class EditorEventBus {
    private handlers = new Map<string, Set<Function>>();

    on<K extends EventKey>(event: K, callback: EventCallback<K>): () => void {
        if (!this.handlers.has(event)) {
            this.handlers.set(event, new Set());
        }
        this.handlers.get(event)!.add(callback);

        return () => {
            this.handlers.get(event)?.delete(callback);
        };
    }

    emit<K extends EventKey>(event: K, payload: EventPayload<K>): void {
        this.handlers.get(event)?.forEach(cb => {
            try {
                (cb as EventCallback<K>)(payload);
            } catch (e) {
                console.error(`[EditorEventBus] Error in handler for "${event}":`, e);
            }
        });
    }

    once<K extends EventKey>(event: K, callback: EventCallback<K>): () => void {
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
