// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { setupMobileWorkspaceView } from '../src/navigation/mobile-workspace-view';

afterEach(() => { document.body.innerHTML = ''; });

it('switches a narrow workspace between the file list and the active editor', async () => {
    const layout = document.createElement('div');
    const sidebar = document.createElement('div');
    const editor = document.createElement('div');
    layout.append(sidebar, editor);
    document.body.append(layout);
    editor.innerHTML = '<div class="mm-placeholder">Choose a file</div>';
    const dispose = setupMobileWorkspaceView(layout, sidebar, editor);
    try {
        expect(layout.dataset.mobileView).toBe('list');
        editor.innerHTML = '<div class="editor">Open file</div>';
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(layout.dataset.mobileView).toBe('detail');
        layout.querySelector<HTMLButtonElement>('.mm-mobile-back')!.click();
        expect(layout.dataset.mobileView).toBe('list');
        sidebar.innerHTML = '<button class="vfs-node-item__content">Open file</button>';
        sidebar.querySelector('button')!.click();
        expect(layout.dataset.mobileView).toBe('detail');
    } finally { dispose(); }
});
