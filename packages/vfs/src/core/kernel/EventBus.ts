// @file vfs/core/kernel/EventBus.ts

import { VFSEvent, VFSEventType } from './types';

type EventHandler<T = unknown> = (event: VFSEvent<T>) => void;
type WildcardHandler = (type: VFSEventType, event: VFSEvent) => void;

/**
 * 类型安全的事件总线
 */
export class EventBus {
  private handlers = new Map<VFSEventType, Set<EventHandler>>();
  private wildcardHandlers = new Set<WildcardHandler>();

  /**
   * 订阅特定类型事件
   */
  on<T = unknown>(type: VFSEventType, handler: EventHandler<T>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as EventHandler);
    return () => this.off(type, handler);
  }

  /**
   * 订阅所有事件
   */
  onAny(handler: WildcardHandler): () => void {
    this.wildcardHandlers.add(handler);
    return () => this.wildcardHandlers.delete(handler);
  }

  /**
   * 取消订阅
   */
  off<T = unknown>(type: VFSEventType, handler: EventHandler<T>): void {
    this.handlers.get(type)?.delete(handler as EventHandler);
  }

  /**
   * 发布事件
   */
  emit<T = unknown>(event: VFSEvent<T>): void {
    // 通知特定类型订阅者
    this.handlers.get(event.type)?.forEach(handler => {
      this.safeCall(() => handler(event));
    });

    // 通知通配符订阅者
    this.wildcardHandlers.forEach(handler => {
      this.safeCall(() => handler(event.type, event));
    });
  }

  /**
   * 清空所有订阅
   */
  clear(): void {
    this.handlers.clear();
    this.wildcardHandlers.clear();
  }

  private safeCall(fn: () => void): void {
    try {
      fn();
    } catch (e) {
      console.error('[EventBus] Handler error:', e);
    }
  }
}
