/**
 * @file vfs-ui/interaction/EventBus.ts
 * @desc Type-safe public event bus implementing IEventPort.
 *       Only for OUTBOUND events to external consumers.
 */
import type { IEventPort } from '../contracts/ports';
import type { PublicEventName, PublicEventPayload } from '../contracts/events';

type Listener<T extends PublicEventName> = (
  payload: PublicEventPayload<T>
) => void;

export class EventBus implements IEventPort {
  private listeners = new Map<string, Set<Listener<any>>>();

  emit<T extends PublicEventName>(
    event: T,
    payload: PublicEventPayload<T>
  ): void {
    this.listeners.get(event)?.forEach(listener => {
      try {
        listener(payload);
      } catch (e) {
        console.error(`[EventBus] Error in listener for ${event}:`, e);
      }
    });
  }

  on<T extends PublicEventName>(
    event: T,
    handler: Listener<T>
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const set = this.listeners.get(event)!;
    set.add(handler);
    return () => set.delete(handler);
  }

  clear(): void {
    this.listeners.clear();
  }
}
