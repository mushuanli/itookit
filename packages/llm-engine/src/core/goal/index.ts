// Goal module — control loop primitive + dependency scheduler + predicates.
//
// S5: Unifies 4 separate scheduling implementations into a single
// DependencyScheduler driven by the reconcile() control loop.

export { DependencyScheduler, CycleError } from './dependency-scheduler';
export type { SchedulerSnapshot } from './dependency-scheduler';

export { reconcile } from './reconciler';
export type { ReconcileOptions } from './reconciler';

export {
    createTruncationPredicate,
    createShellPredicate,
    createLLMJudgePredicate,
} from './predicates';
