// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openTaskTranscript } from '../../llm-ui/src/components/dag/TaskTranscriptDialog';

beforeEach(() => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: vi.fn() });
});
afterEach(() => { document.body.replaceChildren(); Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal'); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

it('renders exchanges as text and exports the loaded task snapshot', async () => {
    vi.useFakeTimers();
    const transcript = { sessionId: 's', runTaskId: 'root', taskId: 'task/1', nodeId: 'agent', status: 'succeeded', version: 4,
        input: '<img src=x onerror=alert(1)>', output: 'done', interactions: {},
        effects: [{ effectId: 'first', status: 'succeeded', request: { kind: 'llm.chat' }, result: 'early response' }] };
    const execute = vi.fn(async () => transcript);
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:transcript'), revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toBe('transcript-task_1.json');
    });
    openTaskTranscript({ execute } as never, 's', 'root', 'task/1');
    await Promise.resolve();
    const dialog = document.querySelector('dialog')!;
    expect(execute).toHaveBeenCalledWith('dag.run.transcript', { sessionId: 's', taskId: 'root', targetTaskId: 'task/1' });
    expect(dialog.querySelector('pre')!.textContent).toContain(transcript.input);
    expect(dialog.querySelector('pre')!.textContent).toContain('early response');
    expect(dialog.querySelector('img')).toBeNull();
    dialog.querySelector<HTMLButtonElement>('[data-export]')!.click();
    expect(click).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('application/json;charset=utf-8');
    expect(blob.size).toBe(new Blob([JSON.stringify(transcript, null, 2)]).size);
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:transcript');
});

it('discards a late response after the transcript dialog is closed', async () => {
    let resolve!: (value: unknown) => void;
    const execute = vi.fn(() => new Promise(done => { resolve = done; }));
    openTaskTranscript({ execute } as never, 's', 'root', 'task');
    const dialog = document.querySelector('dialog')!;
    dialog.dispatchEvent(new Event('close'));
    resolve({ effects: [] });
    await Promise.resolve();
    expect(document.querySelector('dialog')).toBeNull();
    expect(dialog.querySelector<HTMLButtonElement>('[data-export]')!.disabled).toBe(true);
});

it('loads subsequent pages at the original version and enables export only when complete', async () => {
    const base = { sessionId: 's', runTaskId: 'root', taskId: 'task', status: 'succeeded', version: 7,
        input: 'input', output: 'output', interactions: {}, totalEffects: 2 };
    const effect = (effectId: string) => ({ effectId, status: 'succeeded', request: { kind: 'llm.chat' } });
    const execute = vi.fn().mockResolvedValueOnce({ ...base, effects: [effect('first')], nextOffset: 1 })
        .mockResolvedValueOnce({ ...base, effects: [effect('second')] });
    openTaskTranscript({ execute } as never, 's', 'root', 'task');
    await Promise.resolve();
    const dialog = document.querySelector('dialog')!;
    const exportButton = dialog.querySelector<HTMLButtonElement>('[data-export]')!;
    expect(exportButton.disabled).toBe(true);
    dialog.querySelector<HTMLButtonElement>('[data-more]')!.click();
    await Promise.resolve();
    expect(execute).toHaveBeenLastCalledWith('dag.run.transcript', { sessionId: 's', taskId: 'root', targetTaskId: 'task',
        query: { version: 7, offset: 1 } });
    expect(dialog.querySelector('pre')!.textContent).toContain('first');
    expect(dialog.querySelector('pre')!.textContent).toContain('second');
    expect(exportButton.disabled).toBe(false);
    expect(dialog.querySelector<HTMLButtonElement>('[data-more]')!.hidden).toBe(true);
});

it('exports plain text only after all pages, preserving identity and every exchange', async () => {
    vi.useFakeTimers();
    let content = '', mime = '';
    const NativeBlob = Blob;
    vi.stubGlobal('Blob', class extends NativeBlob {
        constructor(parts: BlobPart[], options: BlobPropertyBag) {
            super(parts, options); content = parts.join(''); mime = options.type ?? '';
        }
    });
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:text'), revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toBe('transcript-task_1.txt');
    });
    const base = { sessionId: 'session', runTaskId: 'root', taskId: 'task/1', nodeId: 'agent', status: 'succeeded', version: 7,
        input: 'original input', output: 'final answer', interactions: { choice: 'accepted' }, totalEffects: 2 };
    const effect = (id: string) => ({ effectId: id, status: 'succeeded', request: { kind: 'llm.chat' }, result: id });
    const execute = vi.fn().mockResolvedValueOnce({ ...base, effects: [effect('first exchange')], nextOffset: 1 })
        .mockResolvedValueOnce({ ...base, effects: [effect('second exchange')] });
    openTaskTranscript({ execute } as never, 'session', 'root', 'task/1');
    await Promise.resolve();
    const button = document.querySelector<HTMLButtonElement>('[data-export-text]')!;
    expect(button.disabled).toBe(true); button.click(); expect(click).not.toHaveBeenCalled();
    document.querySelector<HTMLButtonElement>('[data-more]')!.click(); await Promise.resolve();
    expect(button.disabled).toBe(false); button.click();
    expect(mime).toBe('text/plain;charset=utf-8');
    for (const value of ['session', 'root', 'task/1', '"version": 7', 'first exchange', 'second exchange', 'original input', 'final answer', 'accepted']) {
        expect(content).toContain(value);
    }
    expect(click).toHaveBeenCalledOnce();
    vi.runAllTimers();
});
