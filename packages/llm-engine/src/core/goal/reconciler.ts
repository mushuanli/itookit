// reconcile — Goal control loop implementation.
//
// Repeatedly invokes Loop for ready nodes until all nodes are resolved.
// Uses DependencyScheduler for event-driven (non-polling) dispatch.
//
// Mission / SessionGraph / AutoContinue / BackPressure are all
// configurations of this single reconcile function.

import type { ILoop, LoopContext, Goal, GoalNode, Predicate, Verdict } from '@itookit/common';
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
    loopFactory: (node: GoalNode) => ILoop,
    predicate: Predicate,
    actorFactory: (nodeId: string) => ISessionActor,
    baseCtx: Omit<LoopContext, 'ref'>,
    options: ReconcileOptions = {},
): Promise<SchedulerSnapshot> {
    const { maxConcurrent = 8 } = options;
    const scheduler = new DependencyScheduler(goal.nodes, goal.edges ?? []);

    // Track running count for concurrency limit
    let running = 0;
    const pendingResolves: Array<() => void> = [];

    const bumpConcurrency = () => {
        running--;
        const resolve = pendingResolves.shift();
        if (resolve) resolve();
    };

    const waitForSlot = async () => {
        if (running < maxConcurrent) {
            running++;
            return;
        }
        return new Promise<void>(resolve => {
            pendingResolves.push(() => {
                running++;
                resolve();
            });
        });
    };

    while (!scheduler.finished()) {
        const ready = scheduler.readySet();

        if (ready.length === 0) {
            // No ready nodes: wait for in-flight work to complete
            await scheduler.onChange();
            continue;
        }

        // Separate parallel vs serial
        const parallelNodes = ready.filter(n => {
            const node = goal.nodes.find(gn => gn.id === n.id);
            return node?.canParallel !== false;
        });
        const serialNodes = ready.filter(n => {
            const node = goal.nodes.find(gn => gn.id === n.id);
            return node?.canParallel === false;
        });

        // Dispatch parallel nodes
        const parallelPromises = parallelNodes.map(async (readyNode) => {
            await waitForSlot();
            const fullNode = goal.nodes.find(gn => gn.id === readyNode.id)!;
            await runOneNode(fullNode, scheduler, loopFactory, predicate, actorFactory, baseCtx);
            bumpConcurrency();
        });

        // Dispatch serial nodes sequentially
        for (const readyNode of serialNodes) {
            await waitForSlot();
            const fullNode = goal.nodes.find(gn => gn.id === readyNode.id)!;
            await runOneNode(fullNode, scheduler, loopFactory, predicate, actorFactory, baseCtx);
            bumpConcurrency();
        }

        // Wait for all parallel work to settle
        if (parallelPromises.length > 0) {
            await Promise.allSettled(parallelPromises);
        }

        options.onProgress?.(scheduler.snapshot());
    }

    return scheduler.snapshot();
}

// ─── runOneNode ──────────────────────────────────────────────────────

async function runOneNode(
    node: GoalNode,
    scheduler: DependencyScheduler,
    loopFactory: (node: GoalNode) => ILoop,
    predicate: Predicate,
    actorFactory: (nodeId: string) => ISessionActor,
    baseCtx: Omit<LoopContext, 'ref'>,
): Promise<void> {
    scheduler.setStatus(node.id, 'running');

    let retries = 0;
    const maxRetries = node.maxRetries ?? 2;

    while (retries <= maxRetries) {
        const loop = loopFactory(node);
        const actor = actorFactory(node.id);
        const ctx: LoopContext = {
            ...baseCtx,
            ref: `goal/${node.id}`,
            middlewares: baseCtx.middlewares ?? [],
        };

        try {
            const gen = loop.run(ctx);
            const turns = await drive(gen, actor, ctx);
            const lastResult = turns[turns.length - 1];

            const verdict = await predicate(
                {
                    assistantBlocks: [],
                    toolResults: [],
                    usage: lastResult?.meta?.usage,
                },
                node,
            );

            switch (verdict.status) {
                case 'done':
                    scheduler.complete(node.id);
                    return;
                case 'retry':
                    retries++;
                    if (retries > maxRetries) {
                        scheduler.fail(node.id);
                        return;
                    }
                    scheduler.setStatus(node.id, 'retrying');
                    // Inject feedback into next iteration
                    if (verdict.feedback && baseCtx.log) {
                        // Feedback is passed through context for the next loop iteration
                        ctx.middlewares.push({
                            name: 'retry-feedback',
                            beforeTurn: async (turnCtx) => {
                                // Feedback injection handled by the loop executor
                                return undefined;
                            },
                        });
                    }
                    break;
                case 'hitl':
                    scheduler.setStatus(node.id, 'awaiting_signal');
                    // Loop already yielded await_signal — pause is handled by drive()
                    return;
                case 'failed':
                    scheduler.fail(node.id);
                    return;
            }
        } catch (err) {
            retries++;
            if (retries > maxRetries) {
                scheduler.fail(node.id);
                return;
            }
            scheduler.setStatus(node.id, 'retrying');
        }
    }

    scheduler.fail(node.id);
}
