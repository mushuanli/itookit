// @vitest-environment jsdom
/**
 * 粘贴提示条的可见性契约：
 * 只要粘贴结果被改写过，就必须留下一个「能看到的」切换按钮。
 * 这里用真实 EditorView 跑，jsdom 下 coordsAtPos 会抛异常，
 * 正好覆盖「定位失败也必须让提示条可见」这条回归。
 */
import { afterEach, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { ClipboardPlugin } from '../src/plugins/interactions/clipboard.plugin';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

function makeView(doc = ''): EditorView {
    return new EditorView({ state: EditorState.create({ doc }), parent: document.body });
}

function data(html: string, text: string): DataTransfer {
    return {
        files: [], items: [],
        getData: (type: string) => type === 'text/html' ? html : type === 'text/plain' ? text : '',
    } as unknown as DataTransfer;
}

function paste(plugin: ClipboardPlugin, view: EditorView, html: string, text: string): boolean {
    const clipboardData = data(html, text);
    return (plugin as any).handleHtmlPaste({ clipboardData, preventDefault: vi.fn() }, view, clipboardData);
}

function visibleHint(): HTMLElement {
    const hint = document.querySelector<HTMLElement>('.mdx-paste-hint');
    expect(hint, 'hint element must exist').not.toBeNull();
    expect(hint!.classList.contains('mdx-paste-hint--visible'), 'hint must be visible').toBe(true);
    expect(hint!.style.left).not.toBe('');
    expect(hint!.style.top).not.toBe('');
    return hint!;
}

const actionLabel = () => document.querySelector('.mdx-paste-hint__action')?.textContent;

it('keeps the revert button reachable even when view positioning fails', () => {
    const plugin = new ClipboardPlugin();
    const view = makeView('');
    vi.spyOn(view, 'coordsAtPos').mockImplementation(() => { throw new Error('not measurable'); });

    const html = '<h1>BoxLite</h1><pre><code>print(1)</code></pre>';
    expect(paste(plugin, view, html, 'BoxLite\nprint(1)')).toBe(true);

    visibleHint();
    expect(actionLabel()).toBe('保持原文');

    (document.querySelector('.mdx-paste-hint__action') as HTMLButtonElement).click();
    expect(view.state.doc.toString()).toBe('BoxLite\nprint(1)');
    view.destroy();
});

it('pastes markdown source verbatim instead of escaping it', () => {
    const plugin = new ClipboardPlugin();
    const view = makeView('');
    const source = '# BoxLite\n\n> quote\n\n```python\nprint(1)\n```\n\n- a';
    const frames: Array<() => void> = [];
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => { frames.push(cb); return 0; });

    // html 只提供「有语义的富文本」诱因，纯文本才是用户真正想贴的 Markdown 源码
    const html = '<p># BoxLite</p><blockquote><p>quote</p></blockquote><ul><li>a</li></ul>';
    expect(paste(plugin, view, html, source)).toBe(false);

    // 模拟浏览器完成原生粘贴
    view.dispatch({ changes: { from: 0, insert: source }, selection: { anchor: source.length } });
    while (frames.length) frames.shift()!();

    expect(view.state.doc.toString()).toBe(source);
    expect(view.state.doc.toString()).not.toContain('\\');
    visibleHint();
    expect(actionLabel()).toBe('转为 Markdown');
    view.destroy();
});

it('never rewrites the inside of a fenced code block', () => {
    const plugin = new ClipboardPlugin();
    const html = '<p>before</p><pre><code>+--+  +--+\n|a |  |b |   \n\n\n+--+  +--+</code></pre><p>after</p>';

    // 空行与行尾空格都是代码内容，清理只能作用于围栏之外的散文
    expect((plugin as any).convertHtmlToMarkdown(html)).toBe(
        'before\n\n```\n+--+  +--+\n|a |  |b |   \n\n\n+--+  +--+\n```\n\nafter',
    );
});
