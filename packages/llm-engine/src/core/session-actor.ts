// SessionActor — bridges drive() to the session event bus.
//
// This is the concrete implementation of the SessionActor interface
// from loop-driver.ts. It translates canonical AgentEvent emissions
// to the SessionEventBus and manages the signal wait queue.

import type { AgentEvent, Signal } from '@itookit/common';
import type { SessionActor as ISessionActor } from '../core/loop-driver';

export class SessionActor implements ISessionActor {
    private signalResolve: ((signal: Signal) => void) | null = null;
    private signalQueue: Signal[] = [];

    constructor(
        private readonly onEmit: (event: AgentEvent) => void,
    ) {}

    /** Emit a canonical AgentEvent to the session event stream. */
    emit(event: AgentEvent): void {
        this.onEmit(event);
    }

    /**
     * Wait for the next user signal.
     *
     * Signals are queued via pushSignal() from the session manager.
     * If a signal is already waiting, it's returned immediately.
     * Otherwise, the returned promise resolves when pushSignal() is called.
     */
    waitSignal(): Promise<Signal> {
        if (this.signalQueue.length > 0) {
            const signal = this.signalQueue.shift()!;
            return Promise.resolve(signal);
        }
        return new Promise<Signal>((resolve) => {
            this.signalResolve = resolve;
        });
    }

    /** Push a signal from the session manager. */
    pushSignal(signal: Signal): void {
        if (this.signalResolve) {
            const resolve = this.signalResolve;
            this.signalResolve = null;
            resolve(signal);
        } else {
            this.signalQueue.push(signal);
        }
    }

    /** Clear all pending signals and reject any waiting promise. */
    abort(_reason?: string): void {
        if (this.signalResolve) {
            const resolve = this.signalResolve;
            this.signalResolve = null;
            resolve({ type: 'abort' });
        }
        this.signalQueue = [];
    }
}
