// @file: llm-engine/src/persistence/turn-events.ts
// TurnLog → SessionState event stream.
//
// TurnLog emits these events after each mutation. SessionState consumes them
// via apply() as the single state-mutation path, replacing the old manual
// dual-write pattern (engine + state + emit).

import type { TurnId } from '@itookit/common';
import type { TurnProjection } from './turn-types';
import type { NodeStatus } from '../core/types';

export type TurnLogEvent =
    | { type: 'turn:appended'; ref: string; turnId: TurnId; projection: TurnProjection }
    | { type: 'turn:updated'; turnId: TurnId; changes: TurnChangeSet }
    | { type: 'turn:deleted'; turnId: TurnId; cascadeIds?: TurnId[] };

export interface TurnChangeSet {
    assistantContent?: string;
    thinking?: string;
    status?: NodeStatus;
    stale?: boolean;
    _deleted?: boolean;
}
