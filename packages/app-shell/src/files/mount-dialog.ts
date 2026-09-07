import type { DirectoryMountService } from './directory-mounts';
import type { SessionFilesService } from './session-files';

/** One host dialog for sidebar and slash entry points. No Agent-accessible source browser. */
export function showMountDialog(service: DirectoryMountService, files: SessionFilesService, sessionId: string,
    mode: 'mount' | 'home' = 'mount', signal?: AbortSignal): Promise<boolean> {
    return new Promise(resolve => {
        const dialog = document.createElement('dialog'); dialog.className = 'session-mount-dialog';
        const title = document.createElement('h2'); title.textContent = mode === 'home' ? '设置默认目录' : '挂载目录';
        const path = document.createElement('input'); path.placeholder = '/home/admin/projects/demo'; path.setAttribute('aria-label', '来源目录');
        const at = document.createElement('input'); at.placeholder = '/workspace 或其他挂载名称'; at.setAttribute('aria-label', '会话路径');
        const access = document.createElement('select'); access.setAttribute('aria-label', '访问权限');
        for (const [value, label] of [['rw', '可读写'], ['ro', '只读']]) { const option = document.createElement('option'); option.value = value; option.textContent = label; access.append(option); }
        const cwd = document.createElement('input'); cwd.type = 'checkbox';
        const cwdLabel = document.createElement('label'); cwdLabel.append(cwd, document.createTextNode('设为工作目录'));
        const status = document.createElement('p'); status.setAttribute('role', 'status');
        const buttons = document.createElement('div');
        let changed = false, busy = false;
        const abort = () => { dialog.remove(); resolve(changed); };
        signal?.addEventListener('abort', abort, { once: true });
        const close = () => { if (!busy) { signal?.removeEventListener('abort', abort); dialog.remove(); resolve(changed); } };
        const run = async (fn: () => Promise<void>) => {
            if (busy) return; busy = true; dialog.querySelectorAll('button').forEach(button => { button.disabled = true; });
            try { await fn(); } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
            finally { busy = false; dialog.querySelectorAll('button').forEach(button => { button.disabled = false; }); }
        };
        const action = (label: string, fn: () => void) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.onclick = fn; buttons.append(button); };
        action('选择应用目录…', () => { void run(async () => { await browse('/home/admin'); }); });
        action('设置默认目录', () => { void run(async () => { status.textContent = await service.setHome(path.value); changed = true; hint.textContent = `默认目录：${service.getHome()}。设置默认目录不会自动挂载。`; }); });
        if (service.canSelectHost) action('选择宿主目录…', () => { void run(async () => { const selected = await service.chooseDirectory(); if (selected) path.value = selected; else status.textContent = '未选择目录；也可输入应用内目录'; }); });
        action(mode === 'home' ? '保存默认目录' : '挂载', () => { void run(async () => {
            status.textContent = mode === 'home' ? await service.setHome(path.value) : await service.addDirectory(sessionId, path.value, access.value as 'ro' | 'rw', at.value || undefined, cwd.checked);
            changed = true; hint.textContent = `默认目录：${service.getHome() ?? '未设置'}。设置默认目录不会自动挂载。`;
            if (mode === 'mount') await renderMounts();
        }); });
        if (mode === 'mount') action('挂载默认目录', () => { void run(async () => { status.textContent = await service.mountHome(sessionId); changed = true; await renderMounts(); }); });
        action('关闭', close);
        dialog.oncancel = event => { event.preventDefault(); close(); };
        const list = document.createElement('div');
        const chooser = document.createElement('div');
        const browse = async (directory: string) => {
            chooser.replaceChildren();
            const current = document.createElement('button'); current.textContent = `选择 ${directory}`;
            current.onclick = () => { path.value = directory; chooser.replaceChildren(); }; chooser.append(current);
            if (directory !== '/home/admin') {
                const up = document.createElement('button'); up.textContent = '上一级'; up.onclick = () => { void run(() => browse(directory.slice(0, directory.lastIndexOf('/')))); }; chooser.append(up);
            }
            for (const child of await service.listDirectories(directory)) {
                const button = document.createElement('button'); button.textContent = child.split('/').pop()!;
                button.onclick = () => { void run(() => browse(child)); }; chooser.append(button);
            }
        };
        const renderMounts = async () => {
            list.replaceChildren();
            const record = await files.inspect(sessionId);
            for (const mount of record?.mounts ?? []) {
                const row = document.createElement('div');
                const label = document.createElement('span'); label.textContent = `${mount.at} ← ${service.describe(mount)} · ${mount.access === 'ro' ? '只读' : '可读写'}${record?.cwd === mount.at ? ' · 工作目录' : ''}`;
                const remove = document.createElement('button'); remove.textContent = '卸载'; remove.onclick = () => { void run(async () => { await service.remove(sessionId, mount.mountId); changed = true; await renderMounts(); }); };
                const permission = document.createElement('button'); permission.textContent = mount.access === 'ro' ? '改为读写' : '改为只读';
                permission.onclick = () => { void run(async () => { await service.update(sessionId, mount.mountId, mount.access === 'ro' ? 'rw' : 'ro', false); changed = true; await renderMounts(); }); };
                const home = document.createElement('button'); home.textContent = '设为工作目录'; home.onclick = () => { void run(async () => { await service.update(sessionId, mount.mountId, mount.access, true); changed = true; await renderMounts(); }); };
                const reconnect = document.createElement('button'); reconnect.textContent = '重新连接'; reconnect.onclick = () => { void run(async () => { await service.reconnect(sessionId, mount.mountId); changed = true; await renderMounts(); }); };
                row.append(label, permission, home, reconnect, remove); list.append(row);
            }
        };
        const hint = document.createElement('p'); hint.textContent = `默认目录：${service.getHome() ?? '未设置'}。设置默认目录不会自动挂载。`;
        dialog.append(title, hint, path);
        if (mode === 'mount') dialog.append(at, access, cwdLabel);
        dialog.append(buttons, status, chooser, list); document.body.append(dialog); dialog.showModal();
        if (mode === 'mount') void run(renderMounts);
    });
}
