import { expect, it, vi } from 'vitest';
import { StateManager } from './StateManager';
import type { IChatInputPresenter } from '../domain/ports/IChatInputPresenter';
import type { StateService } from '../services/StateService';
import type { SessionManager } from '@itookit/llm-session';
it('restores Session mode even when navigation overrides the input text', () => {
    const manager = new StateManager({} as StateService, {} as SessionManager, 's', id => id);
    const input = { setConfig: vi.fn() } as unknown as IChatInputPresenter;
    manager.restoreInputState(input, { initialInputState: { text: 'new goal' }, sessionSettings: { executionMode: 'agent' } });
    expect(input.setConfig).toHaveBeenCalledWith(expect.objectContaining({ settings: expect.objectContaining({ executionMode: 'agent', flowId: undefined }) }));
    manager.restoreInputState(input, { initialInputState: { text: 'other session' } });
    expect(input.setConfig).toHaveBeenCalledWith(expect.objectContaining({ settings: expect.objectContaining({ executionMode: 'chat' }) }));
    manager.cleanup();
});
it('serializes rapid branch switches and preserves independent drafts before disposal', async () => {
    const drafts = new Map<string, string>([['experiment', 'experiment draft']]);
    let text = 'main draft';
    const input = { getConfig: () => ({ text, agentId: 'default', settings: {} }), setLoading: vi.fn(),
        restoreInput: vi.fn((value: string) => { text = value; }) };
    const service = { saveUIState: async (_id: string, state: { input_text?: string }, branch: string) => { if (state.input_text !== undefined) drafts.set(branch, state.input_text); },
        loadUIState: async (_id: string, branch: string) => ({ input_text: drafts.get(branch) }) };
    const manager = new StateManager(service as unknown as StateService, { isGenerating: () => false } as SessionManager, 's', id => id);
    manager.setChatInputGetter(() => input as unknown as IChatInputPresenter);
    await manager.switchDraftBranch('experiment'); expect(text).toBe('experiment draft');
    text = 'changed experiment';
    const first = manager.switchDraftBranch('main'), second = manager.switchDraftBranch('experiment');
    manager.cleanup(); await manager.waitForDrafts(); await Promise.all([first, second]);
    expect(text).toBe('changed experiment'); expect(drafts.get('main')).toBe('main draft');
    expect(input.setLoading).toHaveBeenLastCalledWith(false);
});

it('keeps a restored branch draft separate from main when a mount reloads the editor', async () => {
    const drafts = new Map<string, string>([['main', 'main draft'], ['experiment', 'restored experiment']]);
    let text = 'restored experiment';
    const service = {
        saveUIState: async (_id: string, state: { input_text?: string }, branch: string) => { if (state.input_text !== undefined) drafts.set(branch, state.input_text); },
        loadUIState: async (_id: string, branch: string) => ({ input_text: drafts.get(branch) }),
    };
    const manager = new StateManager(service as unknown as StateService, { isGenerating: () => false } as SessionManager, 's', id => id, 'experiment');
    manager.setChatInputGetter(() => ({ getConfig: () => ({ text, agentId: 'default', settings: {} }),
        setLoading: vi.fn(), restoreInput: (value: string) => { text = value; } }) as unknown as IChatInputPresenter);
    text = 'updated experiment';
    await manager.switchDraftBranch('main');
    expect(text).toBe('main draft');
    expect(drafts.get('experiment')).toBe('updated experiment');
    manager.cleanup(); await manager.waitForDrafts();
});

it('keeps Stop available when generation starts during branch draft restoration', async () => {
    let generating = false;
    const input = { getConfig: () => ({}), restoreInput: vi.fn(), setLoading: vi.fn() };
    const service = { saveUIState: async () => {}, loadUIState: async () => { generating = true; return {}; } };
    const manager = new StateManager(service as unknown as StateService, { isGenerating: () => generating } as SessionManager, 's', id => id);
    manager.setChatInputGetter(() => input as unknown as IChatInputPresenter);
    await manager.switchDraftBranch('experiment');
    expect(input.setLoading).toHaveBeenLastCalledWith(true);
    manager.cleanup();
});
