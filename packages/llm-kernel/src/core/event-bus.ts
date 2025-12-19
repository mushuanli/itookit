// @file: llm-kernel/core/event-bus.ts

/**
 * 内核事件类型 - 完全解耦于 UI
 */
export type KernelEventType = 
    // 执行生命周期
    | 'execution:start'
    | 'execution:progress'
    | 'execution:complete'
    | 'execution:error'
    | 'execution:cancel'
    
    // 节点事件
    | 'node:start'
    | 'node:update'
    | 'node:complete'
    | 'node:error'
    
    // 流式输出
    | 'stream:thinking'
    | 'stream:content'
    | 'stream:tool_call'
    
    // 交互请求
    | 'interaction:request_input'
    | 'interaction:confirm'
    
    // 状态变更
    | 'state:changed';

export interface KernelEvent<T = any> {
    type: KernelEventType;
    executionId: string;
    nodeId?: string;
    timestamp: number;
    payload: T;
}

/**
 * 事件订阅选项
 */
export interface SubscribeOptions {
    filter?: (event: KernelEvent) => boolean;
    once?: boolean;
    priority?: number;
}

/**
 * 事件总线接口
 */
export interface IEventBus {
    emit<T>(event: KernelEvent<T>): void;
    on(type: KernelEventType | '*', handler: EventHandler, options?: SubscribeOptions): Unsubscribe;
    once(type: KernelEventType, handler: EventHandler): Unsubscribe;
    off(type: KernelEventType, handler: EventHandler): void;
    
    // 执行上下文相关
    createScope(executionId: string): IScopedEventBus;
    destroyScope(executionId: string): void;
}

export type EventHandler<T = any> = (event: KernelEvent<T>) => void | Promise<void>;
export type Unsubscribe = () => void;

/**
 * 作用域事件总线 - 隔离不同执行的事件
 */
export interface IScopedEventBus {
    readonly executionId: string;
    emit<T>(type: KernelEventType, payload: T, nodeId?: string): void;
    on(type: KernelEventType | '*', handler: EventHandler): Unsubscribe;
}

/**
 * 事件总线实现
 */
export class EventBus implements IEventBus {
    private handlers = new Map<string, Set<{ handler: EventHandler; options: SubscribeOptions }>>();
    private scopes = new Map<string, ScopedEventBus>();
    
    emit<T>(event: KernelEvent<T>): void {
        // 按优先级排序处理
        const typeHandlers = this.handlers.get(event.type) || new Set();
        const wildcardHandlers = this.handlers.get('*') || new Set();
        
        const allHandlers = [...typeHandlers, ...wildcardHandlers]
            .sort((a, b) => (b.options.priority || 0) - (a.options.priority || 0));
        
        for (const { handler, options } of allHandlers) {
            // 应用过滤器
            if (options.filter && !options.filter(event)) continue;
            
            try {
                handler(event);
            } catch (e) {
                console.error(`[EventBus] Handler error for ${event.type}:`, e);
            }
            
            // 处理 once
            if (options.once) {
                this.off(event.type, handler);
            }
        }
    }
    
    on(type: KernelEventType | '*', handler: EventHandler, options: SubscribeOptions = {}): Unsubscribe {
        if (!this.handlers.has(type)) {
            this.handlers.set(type, new Set());
        }
        const entry = { handler, options };
        this.handlers.get(type)!.add(entry);
        
        return () => {
            this.handlers.get(type)?.delete(entry);
        };
    }
    
    once(type: KernelEventType, handler: EventHandler): Unsubscribe {
        return this.on(type, handler, { once: true });
    }
    
    off(type: KernelEventType, handler: EventHandler): void {
        const handlers = this.handlers.get(type);
        if (!handlers) return;
        
        for (const entry of handlers) {
            if (entry.handler === handler) {
                handlers.delete(entry);
                break;
            }
        }
    }
    
    createScope(executionId: string): IScopedEventBus {
        if (this.scopes.has(executionId)) {
            return this.scopes.get(executionId)!;
        }
        const scope = new ScopedEventBus(executionId, this);
        this.scopes.set(executionId, scope);
        return scope;
    }
    
    destroyScope(executionId: string): void {
        this.scopes.delete(executionId);
    }
}

/**
 * 作用域事件总线实现
 */
class ScopedEventBus implements IScopedEventBus {
    constructor(
        public readonly executionId: string,
        private parent: EventBus
    ) {}
    
    emit<T>(type: KernelEventType, payload: T, nodeId?: string): void {
        this.parent.emit({
            type,
            executionId: this.executionId,
            nodeId,
            timestamp: Date.now(),
            payload
        });
    }
    
    on(type: KernelEventType | '*', handler: EventHandler): Unsubscribe {
        return this.parent.on(type, handler, {
            filter: (event) => event.executionId === this.executionId
        });
    }
}

// 单例导出
let globalEventBus: EventBus | null = null;

export function getEventBus(): EventBus {
    if (!globalEventBus) {
        globalEventBus = new EventBus();
    }
    return globalEventBus;
}
