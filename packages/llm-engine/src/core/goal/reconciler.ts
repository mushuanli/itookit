// reconcile — Goal control loop implementation.
//
// Phase 4 (WP-07): Continuous capacity fill (not batch wait).
// Each AgentRun gets independent context, trace, pause state, and middleware.
// HITL is removed from Predicate Verdict — handled by loop-level await_signal.

import type { ILoop, LoopContext, Goal, AgentRunSpec, Predicate } from '@itookit/common';
import { DependencyScheduler } from './dependency-scheduler';
import type { SchedulerSnapshot } from './dependency-scheduler';
import { drive } from '../loop-driver';
import type { SessionActor as ISessionActor } from '../loop-driver';

// ─── reconcile options ───────────────────────────────────────────────

export interface ReconcileOptions {
    /** Max concurrent nodes. Default 8. */
    maxConcurrent?: number;
    /** Called on each state change for progress reporting. */
    onProgress?: (snapshot: SchedulerSnapshot) => void;
}

// ─── reconcile ───────────────────────────────────────────────────────

export async function reconcile(
    goal: Goal,
    loopFactory: (spec: AgentRunSpec) => ILoop,
    predicate: Predicate,
    actorFactory: (nodeId: string) => ISessionActor,
    baseCtx: Omit<LoopContext, 'ref'>,
    options: ReconcileOptions = {},
): Promise<SchedulerSnapshot> {
    const { maxConcurrent = 8 } = options;
    const scheduler = new DependencyScheduler(goal.nodes, goal.edges ?? []);
    const specMap = new Map(goal.nodes.map(n => [n.id, n]));

    // Continuous capacity fill — launch new work as soon as a slot opens.
    // Each AgentRun gets an independent loop, context, trace, and pause state.
    const running = new Map<string, Promise<void>>();

    const runNext = async (id: string): Promise<void> => {
        scheduler.setStatus(id, 'running');
        const spec = specMap.get(id)!;
        await runOneNode(spec, scheduler, loopFactory, predicate, actorFactory, baseCtx);
    };

    while (!scheduler.finished()) {
        // Fill available capacity
        const readyIds = scheduler.readyIds();
        for (const id of readyIds) {
            if (running.size >= maxConcurrent) break;
            if (running.has(id)) continue;
            scheduler.setStatus(id, 'ready');
            const promise = runNext(id).finally(() => {
                running.delete(id);
            });
            running.set(id, promise);
        }

        if (running.size === 0) {
            // No work in flight and nothing ready — deadlock or done
            if (!scheduler.finished()) {
                throw new Error('Scheduler deadlock: no running nodes but not finished');
            }
            break;
        }

        // Wait for any running node to complete
        await Promise.race(
            [...running].map(([id, promise]) =>
                promise.then(() => id).catch(() => id)
            ),
        );

        options.onProgress?.(scheduler.snapshot());
    }

    return scheduler.snapshot();
}

// ─── runOneNode ──────────────────────────────────────────────────────

async function runOneNode(
    spec: AgentRunSpec,
    scheduler: DependencyScheduler,
    loopFactory: (spec: AgentRunSpec) => ILoop,
    predicate: Predicate,
    actorFactory: (nodeId: string) => ISessionActor,
    baseCtx: Omit<LoopContext, 'ref'>,
): Promise<void> {
    scheduler.setStatus(spec.id, 'running');

    let retries = 0;
    const maxRetries = spec.maxRetries ?? 2;

    while (retries <= maxRetries) {
        const loop = loopFactory(spec);
        const actor = actorFactory(spec.id);
        // Each AgentRun gets an independent middleware copy (isolated context).
        const ctx: LoopContext = {
            ...baseCtx,
            ref: `goal/${spec.id}`,
            middlewares: [...(baseCtx.middlewares ?? [])],
        };

        try {
            const gen = loop.run(ctx);
            const rounds = await drive(gen, actor, ctx);
            const lastRound = rounds[rounds.length - 1];

            const verdict = await predicate(
                lastRound?.result ?? {
                    assistantBlocks: [],
                    toolResults: [],
                    usage: lastRound?.meta?.usage,
                },
                spec,
            );

            switch (verdict.status) {
                case 'done':
                    scheduler.complete(spec.id);
                    return;
                case 'retry':
                    retries++;
                    if (retries > maxRetries) {
                        scheduler.fail(spec.id);
                        return;
                    }
                    scheduler.setStatus(spec.id, 'retrying');
                    // Phase 4: retry feedback is isolated per AgentRun (not shared middleware)
                    if (verdict.feedback) {
                        ctx.middlewares.push({
                            name: 'retry-feedback',
                            beforeExchange: async (_roundCtx) => {
                                return { action: 'inject', text: verdict.feedback };
                            },
                        });
                    }
                    break;
                case 'failed':
                    scheduler.fail(spec.id);
                    return;
            }
        } catch (err) {
            retries++;
            if (retries > maxRetries) {
                scheduler.fail(spec.id);
                return;
            }
            scheduler.setStatus(spec.id, 'retrying');
        }
    }

    scheduler.fail(spec.id);
}
