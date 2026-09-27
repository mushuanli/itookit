import { createSelectionOperation, type OperationResult, type OperationBatch } from './selection-operation';
export type DeleteResult = OperationResult;
export interface DeleteBatch {
  readonly ids: readonly string[];
  remove(ids: string[], signal: AbortSignal): Promise<DeleteResult>;
}
export interface DeletePlan {
  readonly resources: readonly DeleteBatch[];
  /** Executed only after every resource batch completes successfully. */
  readonly containers?: readonly DeleteBatch[];
}
export interface DeleteOperationOptions<T> {
  resolve(selection: T, signal: AbortSignal): DeletePlan | Promise<DeletePlan>;
  confirm?(plan: DeletePlan, signal: AbortSignal): boolean | Promise<boolean>;
  completed?(plan: DeletePlan, signal: AbortSignal): void | Promise<void>;
}

interface OrderedDeletePlan { batches: Array<OperationBatch & { container: boolean }> }
function deletionPlan(plan: OrderedDeletePlan): DeletePlan {
  const convert = (container: boolean): DeleteBatch[] => plan.batches.filter(batch => batch.container === container)
    .map(batch => ({ ids: batch.ids, remove: batch.execute }));
  return { resources: convert(false), containers: convert(true) };
}

/** Container cleanup is always ordered after resource deletion. */
export function createDeleteOperation<T>(options: DeleteOperationOptions<T>) {
  return createSelectionOperation<T, OrderedDeletePlan>({
    resolve: async (selection, signal) => {
      const plan = await options.resolve(selection, signal);
      return { batches: [
        ...plan.resources.map(batch => ({ ids: batch.ids, execute: batch.remove, container: false })),
        ...(plan.containers ?? []).map(batch => ({ ids: batch.ids, execute: batch.remove, container: true })),
      ] };
    },
    confirm: options.confirm ? (plan, signal) => options.confirm!(deletionPlan(plan), signal) : undefined,
    completed: (plan, signal) => options.completed?.(deletionPlan(plan), signal),
  });
}
