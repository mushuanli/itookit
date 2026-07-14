// @file: llm-engine/session/session-event-bus.ts

import { EventBus } from '@itookit/common';
import { SessionEvent, OrchestratorEvent, RegistryEvent } from '../core/types';
import { log } from '../utils/logger';

// ── Type maps for the two tracks ─────────────────────────────────────────────

/**
 * Map from SessionEvent.type → payload for the EventBus.
 *
 * All events normalize to { type, payload } at the bus level:
 *   - OrchestratorEvent already has { type, payload }
 *   - SessionEvent flat fields become the payload
 *
 * After S7 Step 5 (cleanup), this switches to Omit<E, 'type'> for
 * true flat reconstruction.
 */
type SessionEventMap = {
    [E in SessionEvent as E['type']]: E extends { payload: infer P } ? P : Omit<E, 'type'>;
};

/** Map from RegistryEvent.type → payload, for the global track. */
type RegistryEventMap = {
    [E in RegistryEvent as E['type']]: E['payload'];
};

/**
 * Transitional event type — accepts both old OrchestratorEvent and new
 * SessionEvent during migration. Remove after S7 Step 5.
 */
type TransitionalEvent = SessionEvent | OrchestratorEvent;

/**
 * Session event bus — two isolated tracks:
 *   • session track  — per-session events, routed via channel(sessionId)
 *   • global track   — broadcast RegistryEvent
 *
 * Channel lifecycle = session registration lifecycle:
 *   ensureSession → channel open (emits accepted)
 *   removeSession → channel closed (subsequent emits silently dropped)
 */
export class SessionEventBus {
    private readonly sessionBus = new EventBus<SessionEventMap>();
    private readonly globalBus  = new EventBus<RegistryEventMap>();

    // ── Session lifecycle ──────────────────────────────────────────────────

    ensureSession(sessionId: string): void {
        this.sessionBus.channel(sessionId); // idempotent
    }

    removeSession(sessionId: string): void {
        this.sessionBus.closeChannel(sessionId);
        log.debug('Session removed from event bus', { sessionId });
    }

    hasSession(sessionId: string): boolean {
        return this.sessionBus.hasChannel(sessionId);
    }

    // ── Session events ─────────────────────────────────────────────────────

    onSession(
        sessionId: string,
        handler: (event: SessionEvent) => void,
    ): () => void {
        this.ensureSession(sessionId);
        return this.sessionBus.channel(sessionId).onAny((payload, meta) => {
            try {
                // During transition: reconstruct as { type, payload } wrapper.
                // Consumers handle both old (OrchestratorEvent) and new
                // (SessionEvent) type names via their switch statements.
                handler({ type: meta.type, payload } as SessionEvent);
            } catch (err) {
                log.error('Session event listener error', { sessionId, eventType: meta.type, err });
            }
        });
    }

    /**
     * Emit a session event.
     *
     * Accepts both {@link SessionEvent} and deprecated {@link OrchestratorEvent}
     * during migration. Normalizes to { type, payload } at the bus level.
     */
    emitSession(sessionId: string, event: TransitionalEvent): void {
        if (!this.sessionBus.hasChannel(sessionId)) {
            log.debug('Event dropped (session not registered)', { sessionId, eventType: event.type });
            return;
        }

        let payload: unknown;
        if ('payload' in event) {
            // OrchestratorEvent or wrapper-style SessionEvent
            payload = (event as OrchestratorEvent).payload;
        } else {
            // Flat canonical AgentEvent — rest becomes payload
            const { type: _, ...rest } = event;
            payload = rest;
        }

        this.sessionBus.channel(sessionId).emit(
            event.type as keyof SessionEventMap,
            payload as any,
        );
    }

    /**
     * Clear all local listeners for a session without closing its channel.
     * Background tasks can still emit; UI just stops receiving.
     */
    clearSessionListeners(sessionId: string): void {
        if (!this.sessionBus.hasChannel(sessionId)) return;
        this.sessionBus.channel(sessionId).clearLocal();
    }

    // ── Global events ──────────────────────────────────────────────────────

    onGlobal(handler: (event: RegistryEvent) => void): () => void {
        return this.globalBus.onAny((payload, meta) => {
            try {
                handler({ type: meta.type, payload } as RegistryEvent);
            } catch (err) {
                log.error('Global event listener error', { eventType: meta.type, err });
            }
        });
    }

    emitGlobal(event: RegistryEvent): void {
        this.globalBus.emit(
            event.type as keyof RegistryEventMap,
            event.payload as any,
        );
    }

    clearGlobalListeners(): void {
        this.globalBus.clear();
    }

    // ── Cleanup ────────────────────────────────────────────────────────────

    clear(): void {
        this.sessionBus.clear();
        this.globalBus.clear();
    }

    // ── Debug ──────────────────────────────────────────────────────────────

    stats(): { sessions: number; globalHandlers: number } {
        const s = this.sessionBus.stats();
        const g = this.globalBus.stats();
        return { sessions: s.channels, globalHandlers: g.handlers };
    }
}
