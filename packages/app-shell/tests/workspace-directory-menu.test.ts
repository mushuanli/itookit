// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { WorkspaceDirectoryMenu } from '../../llm-ui/src/shell/WorkspaceDirectoryMenu';
import { showMountDialog } from '../src/files/mount-dialog';
import type { DirectoryMountService, SessionFilesService } from '@itookit/app-core';

const cleanup: Array<() => void> = [];
afterEach(() => { cleanup.splice(0).forEach(close => close()); document.body.replaceChildren(); vi.restoreAllMocks(); });
function menuFixture(running = false) {
    const container = document.createElement('div');
    container.innerHTML = '<div class="llm-workspace-titlebar"><button id="llm-btn-workspace" hidden></button><input></div><div class="llm-input__toolbar"></div>';
    document.body.append(container);
    const configureWorkspace = vi.fn(async () => {});
    const menu = new WorkspaceDirectoryMenu(container, { configureWorkspace, addDirectory: vi.fn(), setHome: vi.fn() }, () => running);
    cleanup.push(() => menu.destroy());
    return { container, configureWorkspace };
}

it('opens the same workspace and mounts actions from the title button and input toolbar context menu', async () => {
    const { container, configureWorkspace } = menuFixture();
    const button = container.querySelector<HTMLButtonElement>('#llm-btn-workspace')!;
    expect(button.hidden).toBe(false); button.click();
    document.querySelector<HTMLButtonElement>('[data-directory-mode="workspace"]')!.click();
    expect(configureWorkspace).toHaveBeenCalledWith('workspace');
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    container.querySelector('.llm-input__toolbar')!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    document.querySelector<HTMLButtonElement>('[data-directory-mode="mount"]')!.click();
    expect(configureWorkspace).toHaveBeenLastCalledWith('mount');
    expect(document.querySelector('[role=menu]')).toBeNull();
});

it('preserves input context menus and prevents configuration while generating', () => {
    const { container, configureWorkspace } = menuFixture(true);
    const inputEvent = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    container.querySelector('input')!.dispatchEvent(inputEvent); expect(inputEvent.defaultPrevented).toBe(false);
    container.querySelector<HTMLButtonElement>('#llm-btn-workspace')!.click();
    const action = document.querySelector<HTMLButtonElement>('[data-directory-mode="workspace"]')!;
    expect(action.disabled).toBe(true); action.click(); expect(configureWorkspace).not.toHaveBeenCalled();
    document.querySelector('[role=menu]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('[role=menu]')).toBeNull();
});

function dialogFixture() {
    HTMLDialogElement.prototype.showModal = vi.fn();
    const controller = new AbortController(); cleanup.push(() => controller.abort());
    const service = { canSelectHost: true, chooseDirectory: vi.fn(async () => '/home/admin/real-project'), getHome: () => undefined,
        setWorkspace: vi.fn(async () => 'saved'), addDirectory: vi.fn(async () => 'mounted'), describe: () => '/actual/source',
    };
    const files = { inspect: vi.fn(async () => ({ cwd: '/workspace', mounts: [
        { mountId: 'w', at: '/workspace', access: 'rw', sourceId: 'source' },
    ] })) };
    return { controller, service, files };
}
const click = (text: string) => Array.from(document.querySelectorAll('button')).find(button => button.textContent === text)!.click();

it('shows exact mapping and sends an explicitly host-qualified primary workspace', async () => {
    const f = dialogFixture();
    const result = showMountDialog(f.service as unknown as DirectoryMountService, f.files as unknown as SessionFilesService, 'session', 'workspace', f.controller.signal);
    await vi.waitFor(() => expect(document.querySelector('table')?.textContent).toContain('/actual/source'));
    click('选择本机目录…');
    await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>('input')?.value).toBe('host:/home/admin/real-project'));
    await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>('button')!.disabled).toBe(false));
    click('应用工作目录');
    await vi.waitFor(() => expect(f.service.setWorkspace).toHaveBeenCalledWith('session', 'host:/home/admin/real-project', 'rw'));
    await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>('button')!.disabled).toBe(false));
    click('完成'); expect(await result).toBe(true);
});

it('adds reference mounts read-only and does not open a dialog after host disposal', async () => {
    const f = dialogFixture();
    const result = showMountDialog(f.service as unknown as DirectoryMountService, f.files as unknown as SessionFilesService, 'session', 'mount', f.controller.signal);
    await vi.waitFor(() => expect(document.querySelector('table')).not.toBeNull());
    document.querySelector<HTMLInputElement>('[aria-label="来源目录"]')!.value = '~/reference';
    document.querySelector<HTMLInputElement>('[aria-label="会话路径"]')!.value = '/reference';
    click('挂载');
    await vi.waitFor(() => expect(f.service.addDirectory).toHaveBeenCalledWith('session', '~/reference', 'ro', '/reference', false));
    f.controller.abort(); expect(await result).toBe(true);
    expect(await showMountDialog(f.service as unknown as DirectoryMountService, f.files as unknown as SessionFilesService, 'session', 'mount', f.controller.signal)).toBe(false);
    expect(document.querySelector('dialog')).toBeNull();
});
