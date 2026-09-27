// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { language } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { defaultEditorFactory } from '../src/factory';
import { MarkedAdapter } from '../src/renderer/marked-adapter';
import { MDxEditor } from '../src/editor/mdx-editor';
import { isLargeDocument } from '../src/editor/document-policy';

beforeEach(() => vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.replaceChildren(); });

it.each(['pnpm-lock.yaml', 'package.json', 'debug.log', 'LICENSE', 'source.txt'])('opens %s as editable source without Markdown parsing', async name => {
    const parse = vi.spyOn(MarkedAdapter.prototype, 'parse');
    const save = vi.fn(async (_path: string, _text: string) => {});
    const element = document.createElement('div'); document.body.append(element);
    const content = '# literal\n- [ ] text\n<script>literal</script>';
    const editor = await defaultEditorFactory(element, { target: { kind: 'file', path: '/' + name }, initialContent: content,
        hostContext: { toggleSidebar() {}, saveContent: save } }) as MDxEditor;
    try {
        expect(editor.getMode()).toBe('edit');
        expect(editor.getEditorView()!.state.facet(language)).toBeNull();
        expect(editor.getText()).toBe(content);
        await editor.switchToMode('render');
        expect(editor.getMode()).toBe('edit'); expect(parse).not.toHaveBeenCalled();
        editor.setText(content + '\nchanged'); editor.setDirty(true);
        await editor.flushPendingSave();
        expect(save).toHaveBeenCalledWith('/' + name, content + '\nchanged');
    } finally { await editor.destroy(); }
});

it('keeps explicit source mode and Markdown document aliases while deferring large previews', async () => {
    const parse = vi.spyOn(MarkedAdapter.prototype, 'parse');
    for (const options of [
        { target: { kind: 'file' as const, path: '/note.md' }, initialMode: 'edit' as const, initialContent: '# normal' },
        { target: { kind: 'file' as const, path: '/large.md' }, initialContent: 'line\n'.repeat(5001) },
        { target: { kind: 'file' as const, path: '/one-line.md' }, initialContent: 'x'.repeat(10_002) },
    ]) {
        const element = document.createElement('div');
        const editor = await defaultEditorFactory(element, options) as MDxEditor;
        expect(editor.getMode()).toBe('edit'); expect(parse).not.toHaveBeenCalled();
        await editor.destroy();
    }
    const editor = await defaultEditorFactory(document.createElement('div'), { target: { kind: 'file', path: '/lesson.prj' },
        contentFormat: 'markdown', initialContent: '# Lesson' }) as MDxEditor;
    expect(editor.getMode()).toBe('render'); expect(parse).toHaveBeenCalledOnce(); await editor.destroy();
});

it('counts UTF-8 bytes, lines and long individual lines for the source-first budget', () => {
    expect(isLargeDocument('中'.repeat(90_000))).toBe(true);
    expect(isLargeDocument('x\n'.repeat(5000))).toBe(true);
    expect(isLargeDocument('x'.repeat(10_001))).toBe(true);
    expect(isLargeDocument('x'.repeat(10_000) + '\n')).toBe(false);
    expect(isLargeDocument('small')).toBe(false);
});

it('opens the repository lockfile without a Markdown parser and respects readonly access', async () => {
    const content = readFileSync('../../pnpm-lock.yaml', 'utf8');
    const parse = vi.spyOn(MarkedAdapter.prototype, 'parse');
    const element = document.createElement('div'); document.body.append(element);
    const editor = await defaultEditorFactory(element, { target: { kind: 'file', path: '/pnpm-lock.yaml' },
        initialContent: content, readOnly: true }) as MDxEditor;
    try {
        expect(editor.getText()).toBe(content);
        expect(editor.getMode()).toBe('edit');
        expect(editor.getEditorView()!.state.facet(EditorView.editable)).toBe(false);
        expect(editor.getEditorView()!.state.facet(language)).toBeNull();
        expect(parse).not.toHaveBeenCalled();
    } finally { await editor.destroy(); }
});
