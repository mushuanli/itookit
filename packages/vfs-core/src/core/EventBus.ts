/**
 * @file vfs/core/EventBus.ts
 * 事件总线
 */

import { VFSEvent, VFSEventType } from './types.js';

type EventHandler = (event: VFSEvent) => void;

export class EventBus {
  private listeners: Map<VFSEventType, Set<EventHandler>> = new Map();

  /**
   * 订阅事件
   */
  on(type: VFSEventType, handler: EventHandler): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    
    this.listeners.get(type)!.add(handler);
    
    // 返回取消订阅函数
    return () => this.off(type, handler);
  }

  /**
   * 取消订阅
   */
  off(type: VFSEventType, handler: EventHandler): void {
    const handlers = this.listeners.get(type);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  /**
   * 发布事件
   */
  emit(event: VFSEvent): void {
    const handlers = this.listeners.get(event.type);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(event);
        } catch (error) {
          console.error(`Error in event handler for ${event.type}:`, error);
        }
      });
    }
  }

  /**
   * 清空所有监听器
   */
  clear(): void {
    this.listeners.clear();
  }
}
