import { expect, it, vi } from 'vitest';
import { createDeleteOperation } from '../src/interaction/deletion';
import { createMoveOperation } from '../src/interaction/movement';

it('deduplicates canonical resources across batches before confirmation and cleans up containers last', async () => {
  const calls: string[][] = [], confirm = vi.fn(() => true), completed = vi.fn();
  const remove = async (ids: string[]) => { calls.push(ids); return 'completed' as const; };
  const run = createDeleteOperation({
    resolve: () => ({ resources: [{ ids: ['a', 'a'], remove }, { ids: ['a', 'b'], remove }], containers: [{ ids: ['group', 'group'], remove }] }),
    confirm, completed,
  });
  expect(await run(undefined)).toBe('completed');
  expect(calls).toEqual([['a'], ['b'], ['group']]);
  expect(confirm.mock.calls[0][0].resources.map(batch => batch.ids)).toEqual([['a'], ['b']]);
  expect(completed).toHaveBeenCalledOnce();
});
it.each(['cancelled', 'failure'] as const)('stops before container deletion on resource %s', async outcome => {
  const container = vi.fn(), completed = vi.fn();
  const run = createDeleteOperation({
    resolve: () => ({ resources: [{ ids: ['a'], remove: async () => {
      if (outcome === 'failure') throw new Error('failure');
      return 'cancelled';
    } }], containers: [{ ids: ['group'], remove: container }] }), completed,
  });
  if (outcome === 'failure') await expect(run(undefined)).rejects.toThrow('failure');
  else expect(await run(undefined)).toBe('cancelled');
  expect(container).not.toHaveBeenCalled(); expect(completed).not.toHaveBeenCalled();
});
it('does not write after asynchronous confirmation cancellation or abort', async () => {
  const remove = vi.fn(), controller = new AbortController();
  const resolve = () => ({ resources: [{ ids: ['a'], remove }] });
  expect(await createDeleteOperation({ resolve, confirm: async () => false })(undefined)).toBe('cancelled');
  expect(await createDeleteOperation({ resolve, confirm: async () => { controller.abort(); return true; } })(undefined, controller.signal)).toBe('cancelled');
  expect(remove).not.toHaveBeenCalled();
});
it('stops after an in-flight write when aborted and does not refresh a destroyed view', async () => {
  const controller = new AbortController(), container = vi.fn(), completed = vi.fn();
  const run = createDeleteOperation({ resolve: () => ({
    resources: [{ ids: ['a'], remove: async () => { controller.abort(); return 'completed'; } }],
    containers: [{ ids: ['group'], remove: container }],
  }), completed });
  expect(await run(undefined, controller.signal)).toBe('cancelled');
  expect(container).not.toHaveBeenCalled(); expect(completed).not.toHaveBeenCalled();
});
it('removes empty containers without requiring resource batches', async () => {
  const remove = vi.fn().mockResolvedValue('completed');
  await createDeleteOperation({ resolve: () => ({ resources: [], containers: [{ ids: ['empty'], remove }] }) })(undefined);
  expect(remove).toHaveBeenCalledOnce();
});
it('moves deduplicated sources to the resolved destination and refreshes only after success', async () => {
  const execute = vi.fn().mockResolvedValue('completed'), completed = vi.fn();
  const run = createMoveOperation<string[], string>({
    resolve: (ids, destination) => {
      expect(destination).toBe('target'); return { batches: [{ ids, execute }] };
    }, completed,
  });
  expect(await run({ selection: ['a', 'a', 'b'], destination: 'target' })).toBe('completed');
  expect(execute.mock.calls[0][0]).toEqual(['a', 'b']);
  expect(completed.mock.calls[0][0].destination).toBe('target');
});
it('does not write when the host rejects a move destination', async () => {
  const completed = vi.fn();
  const run = createMoveOperation({ resolve: () => { throw new Error('Invalid destination'); }, completed });
  await expect(run({ selection: ['a'], destination: 'a/child' })).rejects.toThrow('Invalid destination');
  expect(completed).not.toHaveBeenCalled();
});
