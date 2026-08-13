import { mkdtemp, mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createWorkspacePort, WorkspaceGrantRegistry } from '../src/workspace';

describe('workspace boundary', () => {
    it('allows workspace files and rejects traversal and symlink escapes', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'mindos-workspace-'));
        const outside = await mkdtemp(path.join(tmpdir(), 'mindos-outside-'));
        await mkdir(path.join(root, '.mindos'));
        await writeFile(path.join(root, 'inside.txt'), 'inside');
        await writeFile(path.join(outside, 'secret.txt'), 'secret');
        await symlink(path.join(outside, 'secret.txt'), path.join(root, 'escape.txt'));
        const canonicalRoot = await realpath(root);
        const registry = new WorkspaceGrantRegistry(canonicalRoot, path.join(canonicalRoot, '.mindos'));
        const port = createWorkspacePort(registry);
        await expect(port.readFile(path.join(root, 'inside.txt'))).resolves.toBe('inside');
        await expect(port.readFile(path.join(root, '..', path.basename(outside), 'secret.txt'))).rejects.toThrow('outside');
        await expect(port.readFile(path.join(root, 'escape.txt'))).rejects.toThrow('outside');
        await expect(port.readFile(path.join(root, '.mindos', 'run.json'))).rejects.toThrow();
    });

    it('permits an explicitly granted external directory', async () => {
        const root = await mkdtemp(path.join(tmpdir(), 'mindos-workspace-'));
        const outside = await mkdtemp(path.join(tmpdir(), 'mindos-outside-'));
        await writeFile(path.join(outside, 'allowed.txt'), 'ok');
        const registry = new WorkspaceGrantRegistry(root, path.join(root, '.mindos'));
        await registry.grant(outside, 'read');
        await expect(createWorkspacePort(registry).readFile(path.join(outside, 'allowed.txt'))).resolves.toBe('ok');
    });
});
