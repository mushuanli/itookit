// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { defaultEditorFactory } from '../src/factory';
import { MemoryStore } from '../src/core/store/memory-store';
import type { AssetProvider, EditorHost, StoreFactory } from '../src/editor/contracts';

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

it('runs using only structural host interfaces and saves after an external path update', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    const mount = document.createElement('div'); document.body.append(mount);
    const read = vi.fn(async () => new ArrayBuffer(0));
    const assets: AssetProvider = { read };
    const host: EditorHost = { notify: vi.fn() };
    const storeFactory: StoreFactory = () => new MemoryStore();
    const save = vi.fn(async () => {}); const moved = vi.fn();
    const editor = await defaultEditorFactory(mount, { initialContent: '# Standalone', documentPath: '/doc.txt',
        assets, host, storeFactory, onSave: save, onDocumentPathChange: moved });
    try {
        expect((await editor.getHeadings())[0].text).toBe('Standalone');
        editor.updateDocumentPath('/new.txt'); expect(moved).toHaveBeenCalledWith('/new.txt');
        editor.setText('changed'); editor.setDirty(true); await editor.flushPendingSave();
        expect(save).toHaveBeenCalledWith('changed'); expect(editor.isDirty()).toBe(false);
    } finally { await editor.destroy(); }
});
