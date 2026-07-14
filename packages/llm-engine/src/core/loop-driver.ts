// Loop driver — kernel-side coroutine host.
//
// The ONLY place that touches the ILoop generator. Handles:
//   - yield AgentEvent → emit to EventStream
//   - yield await_signal → checkpoint to Log → suspend → wait for Signal
//   - generator return → final Turn[]
//
// This is the single implementation of the pause/resume protocol.
// HITL / inject / abort / crash-recovery all flow through this function.

import type { LoopContext, Signal, AgentEvent, Turn, ILoop, TurnId } from '@itookit/common';

export interface SessionActor {
    emit(event: AgentEvent): void;
    waitSignal(): Promise<Signal>;
}

export class LoopAbortedError extends Error {
    constructor() {
        super('Loop aborted');
        this.name = 'LoopAbortedError';
    }
}

/**
 * Drive an ILoop coroutine to completion, handling pause/resume.
 *
 * When the generator yields `await_signal`, we:
 *   1. Persist the checkpoint via log.draft().checkpoint()
 *   2. Suspend and wait for a Signal from the session actor
 *   3. Feed the Signal into generator.next(signal) to resume
 *
 * If `abort` signal is received or AbortSignal fires:
 *   - If the generator is at a yield point, generator.return() is called
 *   - NotFound: the next yield point will detect the abort
 */
export async function drive(
    gen: AsyncGenerator<AgentEvent, Turn[], Signal | undefined>,
    session: SessionActor,
    ctx: LoopContext,
): Promise<Turn[]> {
    return driveGenerator(gen, session, ctx);
}

/**
 * Resume a paused ILoop from a checkpoint TurnId.
 *
 * Calls `loop.resume(checkpoint)` to reconstruct coroutine state from the Log,
 * then drives the resulting generator identically to `drive()`.
 *
 * This is the single path for HITL-resume and crash-recovery — the ILoop
 * implementation is responsible for reconstructing its state from the Log
 * at the checkpoint boundary.
 */
export async function resumeDrive(
    loop: ILoop,
    checkpoint: TurnId,
    session: SessionActor,
    ctx: LoopContext,
): Promise<Turn[]> {
    const gen = loop.resume(checkpoint);
    return driveGenerator(gen, session, ctx);
}

// ─── Internal: shared generator driving logic ─────────────────────

async function driveGenerator(
    gen: AsyncGenerator<AgentEvent, Turn[], Signal | undefined>,
    session: SessionActor,
    ctx: LoopContext,
): Promise<Turn[]> {
    let input: Signal | undefined;

    while (true) {
        // Check hard abort before each step
        if (ctx.signal.aborted) {
            await gen.return(undefined as any).catch(() => {});
            throw new LoopAbortedError();
        }

        let result: IteratorResult<AgentEvent, Turn[]>;
        try {
            result = await gen.next(input);
        } catch (err) {
            // If the generator throws, let it propagate after cleanup
            await gen.return(undefined as any).catch(() => {});
            throw err;
        }

        input = undefined;

        if (result.done) {
            return result.value; // Turn[]
        }

        const ev = result.value;

        if (ev.type === 'await_signal') {
            // Persist the pause point so crash-resume can recover
            await ctx.log.draft().checkpoint(ev.request);

            // Suspend — may be hours/days
            const signal = await Promise.race([
                session.waitSignal(),
                abortToRejection(ctx.signal),
            ]);

            // Check if we got aborted while waiting
            if (ctx.signal.aborted) {
                await gen.return(undefined as any).catch(() => {});
                throw new LoopAbortedError();
            }

            input = signal;
        } else {
            session.emit(ev);
        }
    }
}

function abortToRejection(signal: AbortSignal): Promise<never> {
    return new Promise((_, reject) => {
        if (signal.aborted) {
            reject(new LoopAbortedError());
            return;
        }
        const onAbort = () => {
            signal.removeEventListener('abort', onAbort);
            reject(new LoopAbortedError());
        };
        signal.addEventListener('abort', onAbort, { once: true });
    });
}

export function notSupported(mode: string): never {
    throw new Error(`resume() is not supported for executor mode "${mode}"`);
}
