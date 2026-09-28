// @vitest-environment jsdom
import { it, expect, vi } from 'vitest';
import type { ProjectService } from '@itookit/app-core';
import { t } from '@itookit/common';
import { remoteConnectionError } from '../src/files/remote-connection-error';
import { RemoteFilesSettingsEditor } from '../src/files/RemoteFilesSettingsEditor';

it('embeds without viewport height, checks drafts inside the dialog, and keeps blank passwords on edit', async () => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() {} });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() {} });
    const checkDraft = vi.fn().mockResolvedValue(undefined), saveConnection = vi.fn().mockResolvedValue('id');
    const service = { remoteMounts: {
        connections: () => [{ id: 'id', name: 'Office', endpoint: 'http://localhost:8787', username: 'user', credentialRef: 'ref' }],
        connectionStatus: () => 'unknown', onChange: () => () => {}, checkDraft, saveConnection,
    } } as unknown as ProjectService;
    const container = document.createElement('div'); document.body.append(container);
    const editor = new RemoteFilesSettingsEditor(container, service, {});
    try {
        await editor.init(container);
        expect(container.classList.contains('settings-root')).toBe(false);
        expect(container.textContent).not.toContain(t('remote.check'));
        Array.from(container.querySelectorAll('button')).find(item => item.textContent === t('remote.connectionEdit'))!.click();
        const dialog = document.querySelector('dialog')!;
        const password = dialog.querySelector<HTMLInputElement>('input[type="password"]')!;
        expect(password.placeholder).toBe(t('remote.passwordKeep'));
        checkDraft.mockRejectedValueOnce({ code: 'EIO', operation: 'connect' });
        const checkButton = Array.from(dialog.querySelectorAll('button')).find(item => item.textContent === t('remote.check'))!;
        checkButton.click();
        await vi.waitFor(() => expect(dialog.textContent).toContain(remoteConnectionError({ operation: 'connect' })));
        expect(dialog.textContent).not.toContain('remote.checkFailed');
        expect(saveConnection).not.toHaveBeenCalled();
        await vi.waitFor(() => expect(checkButton.disabled).toBe(false));
        checkButton.click();
        await vi.waitFor(() => expect(dialog.textContent).toContain(t('remote.checkSuccess')));
        expect(saveConnection).not.toHaveBeenCalled();
        dialog.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
        await vi.waitFor(() => expect(saveConnection).toHaveBeenCalledWith(expect.objectContaining({ name: 'Office' }), '', 'id'));
        expect(checkDraft).toHaveBeenCalledWith(expect.anything(), '', 'id', expect.anything());
    } finally { await editor.destroy(); container.remove(); }
});
