// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { ClipboardPlugin } from '../src/plugins/interactions/clipboard.plugin';
it('allows keyboard users to Tab from the editor to the paste action', () => {
    const plugin = new ClipboardPlugin();
    const view = new EditorView({ state: EditorState.create({ doc: '' }), parent: document.body });
    try {
        const data = { getData: (type: string) => type === 'text/html' ? '<h1>Title</h1>' : 'Title' };
        (plugin as any).handleHtmlPaste({ preventDefault() {} }, view, data);
        expect(document.querySelector('.mdx-paste-hint--visible')).not.toBeNull();
        view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
        expect(document.querySelector('.mdx-paste-hint--visible')).not.toBeNull();
    } finally { plugin.destroy(); view.destroy(); }
});
it('preserves code whitespace when content contains a shorter fence', () => {
    const plugin = new ClipboardPlugin();
    try {
        const code = 'before\n```\nafter   \n\n\nend';
        const result = (plugin as any).convertHtmlToMarkdown('<pre><code>' + code + '</code></pre>');
        expect(result).toContain(code);
    } finally { plugin.destroy(); }
});
