// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import type { PluginContext } from '../src/core/types';
import { MathJaxPlugin } from '../src/plugins/syntax-extensions/mathjax.plugin';
import { MermaidPlugin } from '../src/plugins/syntax-extensions/mermaid.plugin';

afterEach(() => {
    vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
    document.head.replaceChildren(); document.body.replaceChildren();
    delete window.MathJax; delete window.mermaid;
});

function context() {
    let update: ((event: { element: HTMLElement }) => void) | undefined;
    return {
        value: {
            registerSyntaxExtension() {},
            on(type: string, listener: (event: { element: HTMLElement }) => void) {
                if (type === 'domUpdated') update = listener;
                return () => { update = undefined; };
            },
        } as unknown as PluginContext,
        update(element: HTMLElement) { update?.({ element }); },
    };
}

it('does not load diagram runtimes for ordinary markdown', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const math = new MathJaxPlugin(), mermaid = new MermaidPlugin();
    const mathContext = context(), mermaidContext = context();
    math.install(mathContext.value); mermaid.install(mermaidContext.value);
    const ordinary = document.createElement('div'); ordinary.textContent = 'plain markdown'; document.body.append(ordinary);
    mathContext.update(ordinary); mermaidContext.update(ordinary);
    await vi.advanceTimersByTimeAsync(200);
    expect(document.querySelector('#mathjax-script')).toBeNull();
    expect(window.mermaid).toBeUndefined();
    math.destroy(); mermaid.destroy();
});

it('loads MathJax only after rendered math appears', async () => {
    vi.useFakeTimers();
    const plugin = new MathJaxPlugin(), pluginContext = context();
    plugin.install(pluginContext.value);
    const math = document.createElement('div'); math.textContent = '\\(x + y\\)'; document.body.append(math);
    pluginContext.update(math); await vi.advanceTimersByTimeAsync(60);
    expect(document.querySelector<HTMLScriptElement>('#mathjax-script')?.src).toContain('mathjax');
    plugin.destroy();
});
