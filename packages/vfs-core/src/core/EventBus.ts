/**
 * @file vfs/core/EventBus.ts
 * 事件总线
 */
import { VFSEvent, VFSEventType } from './types';

type EventHandler = (event: VFSEvent) => void;

export class EventBus {
  private listeners = new Map<VFSEventType, Set<EventHandler>>();

  /**
   * 订阅事件
   */
  on(type: VFSEventType, handler: EventHandler): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type)!.add(handler);
    return () => this.off(type, handler);
  }

  /**
   * 取消订阅
   */
  off(type: VFSEventType, handler: EventHandler): void {
    this.listeners.get(type)?.delete(handler);
  }

  emit(event: VFSEvent): void {
    this.listeners.get(event.type)?.forEach(handler => {
      try { handler(event); } 
      catch (e) { console.error(`Event handler error for ${event.type}:`, e); }
    });
  }

  clear(): void {
    this.listeners.clear();
  }
}
