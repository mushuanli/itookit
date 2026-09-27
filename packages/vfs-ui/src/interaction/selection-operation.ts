export type OperationResult = 'completed' | 'cancelled';
/** IDs must identify canonical resources within this operation's scope. */
export interface OperationBatch {
  readonly ids: readonly string[];
  execute(ids: string[], signal: AbortSignal): Promise<OperationResult>;
}
export interface SelectionPlan { readonly batches: readonly OperationBatch[] }
export interface SelectionOperationOptions<T, P extends SelectionPlan = SelectionPlan> {
  resolve(selection: T, signal: AbortSignal): P | Promise<P>;
  confirm?(plan: P, signal: AbortSignal): boolean | Promise<boolean>;
  completed?(plan: P, signal: AbortSignal): void | Promise<void>;
}

function normalize<P extends SelectionPlan>(plan: P): P {
  const seen = new Set<string>();
  const batches = plan.batches.flatMap(batch => {
    const ids = batch.ids.filter(id => { if (seen.has(id)) return false; seen.add(id); return true; });
    return ids.length ? [{ ...batch, ids }] : [];
  });
  return { ...plan, batches };
}

/** Compose with ActionRunner for UI locking and error reporting; writes are not rolled back. */
export function createSelectionOperation<T, P extends SelectionPlan = SelectionPlan>(options: SelectionOperationOptions<T, P>) {
  return async (selection: T, signal: AbortSignal = new AbortController().signal): Promise<OperationResult> => {
    if (signal.aborted) return 'cancelled';
    const plan = normalize(await options.resolve(selection, signal));
    if (signal.aborted) return 'cancelled';
    if (!plan.batches.length) return 'completed';
    if (options.confirm && !await options.confirm(plan, signal)) return 'cancelled';
    for (const batch of plan.batches) {
      if (signal.aborted || await batch.execute([...batch.ids], signal) === 'cancelled') return 'cancelled';
    }
    if (signal.aborted) return 'cancelled';
    await options.completed?.(plan, signal);
    return 'completed';
  };
}
