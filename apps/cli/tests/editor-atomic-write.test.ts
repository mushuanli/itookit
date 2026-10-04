import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeFsOps } from '@itookit/vfsdriver-local/node';

let root: string;
beforeEach(async () => { root = await fs.mkdtemp(join(tmpdir(), 'localfs-atomic-')); });
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true }); });

it('retries editor content through the real atomic writer after publication failure', async () => {
    const { SaveManager } = await import('../../../packages/mdx/src/editor/save-manager');
    const path = join(root, 'document.md');
    await fs.writeFile(path, 'original');
    const writer = new NodeFsOps();
    const manager = new SaveManager(content => writer.writeFile(path, new TextEncoder().encode(content).buffer));
    const onError = vi.fn(), onSuccess = vi.fn();
    manager.setDirty(true);
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('publication failed'));
    await manager.save(() => 'edited', onSuccess, onError);
    expect(manager.isDirty()).toBe(true);
    expect(await fs.readFile(path, 'utf8')).toBe('original');
    manager.setDirty(true);
    await manager.save(() => 'newer edit', onSuccess, onError);
    expect(manager.isDirty()).toBe(false);
    expect(await fs.readFile(path, 'utf8')).toBe('newer edit');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(await fs.readdir(root)).toEqual(['document.md']);
});
