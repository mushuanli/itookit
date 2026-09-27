import { createSelectionOperation, type SelectionPlan, type SelectionOperationOptions } from './selection-operation';
export interface MoveRequest<T, D> { readonly selection: T; readonly destination: D }
export interface MovePlan<D> extends SelectionPlan { readonly destination: D }
export interface MoveOperationOptions<T, D> extends Omit<SelectionOperationOptions<MoveRequest<T, D>, MovePlan<D>>, 'resolve'> {
  /** Resolve complete sources and validate the destination before any write. */
  resolve(selection: T, destination: D, signal: AbortSignal): SelectionPlan | Promise<SelectionPlan>;
}

export function createMoveOperation<T, D>(options: MoveOperationOptions<T, D>) {
  return createSelectionOperation({
    ...options,
    resolve: async ({ selection, destination }: MoveRequest<T, D>, signal: AbortSignal) => ({
      ...await options.resolve(selection, destination, signal), destination,
    }),
  });
}
