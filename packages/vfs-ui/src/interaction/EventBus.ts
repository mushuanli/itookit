/**
 * @file vfs-ui/interaction/EventBus.ts
 * @desc Type-safe public event bus implementing IEventPort.
 *       Only for OUTBOUND events to external consumers.
 */
import { EventBus as CoreEventBus } from '@itookit/stdio';
import type { IEventPort } from '../contracts/ports';
import type { PublicEventMap, PublicEventName, PublicEventPayload } from '../contracts/events';

export class EventBus implements IEventPort {
  private bus = new CoreEventBus<PublicEventMap>();

  emit<T extends PublicEventName>(event: T, payload: PublicEventPayload<T>): void {
    this.bus.emit(event, payload);
  }

  on<T extends PublicEventName>(
    event: T,
    handler: (payload: PublicEventPayload<T>) => void,
  ): () => void {
    return this.bus.on(event, (payload) => handler(payload));
  }

  clear(): void {
    this.bus.clear();
  }
}
