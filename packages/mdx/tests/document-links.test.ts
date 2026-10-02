// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resolveDocumentLink } from '../src/editor/document-links';
import { defaultEditorFactory } from '../src/factory';
import type { MDxEditor } from '../src/editor/mdx-editor';

beforeEach(() => vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} })));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.replaceChildren(); });

it('resolves relative references, encoded filenames and fragments in the document namespace', () => {
    expect(resolveDocumentLink('../其他%20文档.md#说明', '/workspace/docs/start.md')).toEqual({ path: '/workspace/其他 文档.md', anchor: '说明' });
    expect(resolveDocumentLink('./nested/../next.md?view=preview#intro', '/docs/start.md')).toEqual({ path: '/docs/next.md', anchor: 'intro' });
    expect(resolveDocumentLink('#intro', '/docs/start.md')).toEqual({ path: '/docs/start.md', anchor: 'intro' });
    expect(resolveDocumentLink('/root.md', '/docs/start.md')?.path).toBe('/root.md');
    for (const href of ['https://example.com/doc.md', '//example.com', 'mailto:me@example.com', '@asset/file.pdf', 'blob:asset', 'mdx://file/a']) expect(resolveDocumentLink(href, '/docs/start.md')).toBeUndefined();
});

it('opens rendered document references using the current path after moving the editor', async () => {
    const mount = document.createElement('div'); document.body.append(mount);
    const openFile = vi.fn(async () => {});
    const editor = await defaultEditorFactory(mount, { target: { kind: 'file', path: '/docs/start.md' }, initialMode: 'render',
        initialContent: '[Next](../next.md#intro)\n\n[Local](#intro)\n\n# Intro',
        hostContext: { openFile, toggleSidebar() {}, navigate: async () => {} } }) as MDxEditor;
    try {
        const next = mount.querySelector<HTMLAnchorElement>('a[href="../next.md#intro"]')!;
        expect(next).not.toBeNull(); next.click();
        await vi.waitFor(() => expect(openFile).toHaveBeenCalledWith('/next.md', 'intro'));
        editor.updateNodeId('/moved/deeper/start.md'); next.click();
        await vi.waitFor(() => expect(openFile).toHaveBeenLastCalledWith('/moved/next.md', 'intro'));
        const navigate = vi.spyOn(editor, 'navigateTo').mockResolvedValue(undefined);
        mount.querySelector<HTMLAnchorElement>('a[href="#intro"]')!.click();
        await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith({ elementId: 'intro' }));
        expect(openFile).toHaveBeenCalledTimes(2);
    } finally { await editor.destroy(); }
});
