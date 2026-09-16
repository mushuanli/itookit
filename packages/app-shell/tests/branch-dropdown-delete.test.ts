// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { BranchIndicatorView } from '../../llm-ui/src/components/indicators/BranchIndicatorView';

it('deletes exactly once without switching, even after reopening the dropdown', async () => {
    const host = document.createElement('div'); document.body.append(host);
    const branches = [{ name: 'main', isCurrent: true }, { name: 'review <1>', isCurrent: false }];
    let changed!: () => void;
    const emit = vi.fn();
    const view = new BranchIndicatorView({ byId: () => host, invalidate() {} } as never, { emit } as never,
        { current: branches, currentBranch: branches[0], onChange: (fn: () => void) => { changed = fn; return () => {}; }, refresh: async () => changed() } as never);
    try {
        await view.refresh();
        const toggle = () => host.querySelector<HTMLButtonElement>('.llm-branch-indicator-btn')!.click();
        toggle(); toggle(); toggle();
        const buttons = host.querySelectorAll<HTMLButtonElement>('.llm-branch-dropdown__delete');
        expect(buttons[0].disabled).toBe(true);
        buttons[1].click();
        expect(emit.mock.calls).toEqual([['branch:delete', { branchName: 'review <1>' }]]);
        toggle();
        host.querySelectorAll<HTMLElement>('.llm-branch-dropdown__name')[1].click();
        expect(emit.mock.calls.at(-1)).toEqual(['branch:switch', { branchName: 'review <1>' }]);
    } finally { view.destroy(); host.remove(); }
});

it('refreshes the branch list after deletion succeeds', async () => {
    const { SessionEventHandler } = await import('../../llm-ui/src/shell/SessionEventHandler');
    const refresh = vi.fn(), onNavRefresh = vi.fn();
    const handler = new SessionEventHandler({ historyView: { processEvent() {} }, branchStore: { refresh }, onNavRefresh } as never);
    handler.handleSessionEvent({ type: 'log:ref_deleted', payload: { ref: 'review' } } as never);
    expect(refresh).toHaveBeenCalledOnce();
    expect(onNavRefresh).toHaveBeenCalledOnce();
});
