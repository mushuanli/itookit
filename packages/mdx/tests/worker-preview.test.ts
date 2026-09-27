// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { Marked } from 'marked';
import { MarkedAdapter } from '../src/renderer/marked-adapter';
import { MDxRenderer } from '../src/renderer/mdx-renderer';
import { builtinTokenizer, lexicalExtension, type WorkerSyntax } from '../src/renderer/worker-tokenizers';
import { lexInWorker } from '../src/renderer/worker-lexer';
import { TaskListPlugin } from '../src/plugins/interactions/task-list.plugin';

class TestWorker {
    static instances: TestWorker[] = [];
    onmessage?: (event: any) => void;
    onerror?: (event: any) => void;
    terminate = vi.fn();
    constructor() { TestWorker.instances.push(this); }
    postMessage(data: { text: string; syntax: WorkerSyntax[]; options: any }) {
        const marked = new Marked(...data.syntax.map(lexicalExtension));
        const tokens = marked.lexer(data.text, { ...marked.defaults, ...data.options });
        queueMicrotask(() => this.onmessage?.({ data: { tokens } }));
    }
}
afterEach(() => { vi.unstubAllGlobals(); TestWorker.instances = []; });

it('preserves HTML across synchronous and worker lexing, including custom built-in tokens', async () => {
    vi.stubGlobal('Worker', TestWorker);
    const names: WorkerSyntax[] = ['math-display', 'math-inline', 'cloze:cloze', 'mdxLink', 'mdxTransclusion'];
    const extensions = names.map(name => ({ extensions: [{ ...lexicalExtension(name).extensions![0],
        renderer: (token: any) => `<span>${token.text ?? token.content ?? token.id}|${token.locator ?? ''}</span>` }] }));
    const adapter = new MarkedAdapter();
    const text = '# Title\n\n$x$ and --[known] hidden-- [label](mdx://notes/one)\n\n$$y$$\n\n!@notes:two\n';
    const expected = await adapter.parse(text, extensions);
    expect(await adapter.parse(text + '\n'.repeat(33_000), extensions)).toBe(expected);
    expect(TestWorker.instances).toHaveLength(1);
    expect(TestWorker.instances[0].terminate).toHaveBeenCalledOnce();
});

it('retains AST task offsets and excludes fenced examples after worker analysis', async () => {
    vi.stubGlobal('Worker', TestWorker);
    const hooks = new Map<string, Function>(), plugin = new TaskListPlugin();
    plugin.install({ registerSyntaxExtension() {}, on: (name: string, fn: Function) => { hooks.set(name, fn); return () => {}; } } as any);
    const text = '```md\n- [ ] example\n```\n\n| task |\n| --- |\n| [ ] real |\n' + '\n'.repeat(33_000);
    await hooks.get('beforeParse')!({ markdown: text });
    expect((plugin as any).taskLocations).toEqual([{ bracketIndex: text.indexOf('[ ] real'), length: 3, isTableTask: true, lineNumber: 7 }]);
    expect(TestWorker.instances).toHaveLength(1); plugin.destroy();
});

it('terminates an obsolete render before a newer result reaches the DOM', async () => {
    class SlowWorker extends TestWorker { postMessage() {} }
    vi.stubGlobal('Worker', SlowWorker);
    const renderer = new MDxRenderer(), element = document.createElement('div');
    const obsolete = renderer.render(element, 'old '.repeat(10_000));
    const rejected = expect(obsolete).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(TestWorker.instances).toHaveLength(1));
    await renderer.render(element, '# Current'); await rejected;
    expect(element.textContent).toContain('Current');
    expect(TestWorker.instances[0].terminate).toHaveBeenCalledOnce(); renderer.destroy();
});

it('rejects cancellation and unsupported tokenizers without synchronous fallback', async () => {
    const controller = new AbortController();
    const worker = { terminate: vi.fn(), postMessage: vi.fn() } as any;
    const result = lexInWorker('large', [], {}, controller.signal, () => worker);
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort(); await rejected; expect(worker.terminate).toHaveBeenCalledOnce();
    const tokenizer = vi.fn(builtinTokenizer('math-inline'));
    await expect(new MarkedAdapter().parse('x'.repeat(33_000), [{ extensions: [{ name: 'custom', level: 'inline', tokenizer }] }])).rejects.toThrow('worker implementation');
    expect(tokenizer).not.toHaveBeenCalled();
});

it('releases the construction signal after init so an adopted editor can preview again', async () => {
    const { MDxEditor } = await import('../src/editor/mdx-editor');
    const controller = new AbortController(), container = document.createElement('div');
    const editor = new MDxEditor({ signal: controller.signal });
    await editor.init(container, '# Retained'); controller.abort();
    await editor.switchToMode('render');
    expect(container.querySelector('h1')?.textContent).toBe('Retained');
    editor.cancelPendingRender(); expect(editor.getMode()).toBe('edit');
    await editor.destroy();
});

it('does not commit stale streaming state after a delayed DOM hook', async () => {
    let finish!: () => void;
    const updated = vi.fn(async () => {});
    updated.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    const renderer = new MDxRenderer(), element = document.createElement('div');
    renderer.usePlugin({ name: 'delayed-dom', install(context) { context.on('domUpdated', updated); } });
    const old = renderer.renderStreaming(element, '# Old');
    const rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(updated).toHaveBeenCalledOnce());
    await renderer.renderStreaming(element, '# Current');
    finish(); await rejected;
    await renderer.renderStreaming(element, '# Current');
    expect(updated).toHaveBeenCalledTimes(2);
    expect(element.textContent).toBe('Current'); renderer.destroy();
});
