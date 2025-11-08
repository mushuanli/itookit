// @file vfs-ui/core/EventBus.ts
import type { EventCallback, UnsubscribeFn } from '../interfaces/IVFSUIManager';

type EventMap = Map<string, Set<EventCallback>>;

export class EventBus {
  private events: EventMap;

  constructor() {
    this.events = new Map();
  }

  /**
   * 订阅事件
   */
  on(event: string, callback: EventCallback): UnsubscribeFn {
    if (!this.events.has(event)) {
      this.events.set(event, new Set());
    }

    const callbacks = this.events.get(event)!;
    callbacks.add(callback);

    // 返回取消订阅函数
    return () => {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this.events.delete(event);
      }
    };
  }

  /**
   * 订阅一次性事件
   */
  once(event: string, callback: EventCallback): UnsubscribeFn {
    const wrappedCallback: EventCallback = (data: any) => {
      callback(data);
      unsubscribe();
    };

    const unsubscribe = this.on(event, wrappedCallback);
    return unsubscribe;
  }

  /**
   * 触发事件
   */
  emit(event: string, data?: any): void {
    const callbacks = this.events.get(event);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in event handler for '${event}':`, error);
        }
      });
    }
  }

  /**
   * 移除指定事件的所有监听器
   */
  off(event: string): void {
    this.events.delete(event);
  }

  /**
   * 清空所有事件监听器
   */
  clear(): void {
    this.events.clear();
  }

  /**
   * 获取事件监听器数量
   */
  listenerCount(event: string): number {
    const callbacks = this.events.get(event);
    return callbacks ? callbacks.size : 0;
  }

  /**
   * 获取所有已注册的事件名称
   */
  eventNames(): string[] {
    return Array.from(this.events.keys());
  }
}
