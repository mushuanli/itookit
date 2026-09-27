import { expect, it, vi } from 'vitest';
import { RefreshScheduler } from '../src/services/RefreshScheduler';

it('coalesces bursts and changes during an in-flight refresh', async () => {
  let finish!: () => void;
  const refresh = vi.fn(async () => {});
  refresh.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const scheduler = new RefreshScheduler(refresh, vi.fn());
  for (let i = 0; i < 30; i++) scheduler.request();
  await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  for (let i = 0; i < 30; i++) scheduler.request();
  finish(); await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
  scheduler.destroy();
});

it('retains hidden invalidations and drops work after disposal', async () => {
  const refresh = vi.fn(async () => {}), scheduler = new RefreshScheduler(refresh, vi.fn());
  scheduler.setVisible(false); scheduler.request(); scheduler.request();
  await Promise.resolve(); expect(refresh).not.toHaveBeenCalled();
  scheduler.setVisible(true); await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  scheduler.request(); scheduler.destroy(); await Promise.resolve();
  expect(refresh).toHaveBeenCalledOnce();
});

it('reports failure and accepts the next invalidation', async () => {
  const failure = new Error('offline'), report = vi.fn(), refresh = vi.fn(async () => {});
  refresh.mockRejectedValueOnce(failure);
  const scheduler = new RefreshScheduler(refresh, report);
  scheduler.request(); await vi.waitFor(() => expect(report).toHaveBeenCalledWith(failure));
  scheduler.request(); await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
  scheduler.destroy();
});

it('wires source changes through visibility and coalescing without explicit host refresh', async () => {
  const { SourceAdapter } = await import('../src/browser/SourceAdapter');
  let changed!: () => void;
  const children = vi.fn(async () => []), dispatch = vi.fn();
  const source = { children, get: async () => undefined,
    subscribe: (callback: () => void) => { changed = callback; return () => {}; } };
  const store = { dispatch, getState: () => ({ expandedFolderIds: new Set(), items: [] }) };
  const adapter = new SourceAdapter(source, store as any);
  adapter.connectEngineEvents(); adapter.setVisible(false);
  changed(); changed(); await Promise.resolve(); expect(children).not.toHaveBeenCalled();
  adapter.setVisible(true); await vi.waitFor(() => expect(dispatch).toHaveBeenCalledOnce());
  expect(children).toHaveBeenCalledOnce(); adapter.destroy();
});
