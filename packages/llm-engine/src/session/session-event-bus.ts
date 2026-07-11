// @file: llm-engine/session/session-event-bus.ts

import { EventBus } from '@itookit/common';
import { OrchestratorEvent, RegistryEvent } from '../core/types';
import { log } from '../utils/logger';

// ── Type maps for the two tracks ─────────────────────────────────────────────

/** Map from OrchestratorEvent.type → payload, for the session track. */
type OrchestratorEventMap = {
    [E in OrchestratorEvent as E['type']]: E['payload'];
};

/** Map from RegistryEvent.type → payload, for the global track. */
type RegistryEventMap = {
    [E in RegistryEvent as E['type']]: E['payload'];
};

/**
 * Session event bus — two isolated tracks:
 *   • session track  — per-session OrchestratorEvent, routed via channel(sessionId)
 *   • global track   — broadcast RegistryEvent
 *
 * Channel lifecycle = session registration lifecycle:
 *   ensureSession → channel open (emits accepted)
 *   removeSession → channel closed (subsequent emits silently dropped)
 */
export class SessionEventBus {
    private readonly sessionBus = new EventBus<OrchestratorEventMap>();
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
        handler: (event: OrchestratorEvent) => void,
    ): () => void {
        this.ensureSession(sessionId);
        return this.sessionBus.channel(sessionId).onAny((payload, meta) => {
            try {
                handler({ type: meta.type, payload } as OrchestratorEvent);
            } catch (err) {
                log.error('Session event listener error', { sessionId, eventType: meta.type, err });
            }
        });
    }

    emitSession(sessionId: string, event: OrchestratorEvent): void {
        if (!this.sessionBus.hasChannel(sessionId)) {
            log.debug('Event dropped (session not registered)', { sessionId, eventType: event.type });
            return;
        }
        this.sessionBus.channel(sessionId).emit(
            event.type as keyof OrchestratorEventMap,
            event.payload as any,
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
