/**
 * @file packages/vfslib/src/event/event-bus.ts
 * @desc Typed VFS event bus — re-exports the unified core and provides FS-specific aliases.
 */
import type { FSEventPayloadMap } from '@itookit/common';
import { EventBus as CoreEventBus, EventBuffer as CoreEventBuffer } from '@itookit/common';

/** Concrete VFS event bus class — typed to FSEventPayloadMap. */
export class EventBus extends CoreEventBus<FSEventPayloadMap> {}

/** Typed event buffer for VFS transactions. */
export class TransactionEventBuffer extends CoreEventBuffer<FSEventPayloadMap> {}
