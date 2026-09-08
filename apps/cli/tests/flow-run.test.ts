import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { runCommand } from '../src/commands';

const cleanup: string[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

it('runs a .flow draft through RunDefinition without YAML environment', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mindos-flow-run-'));
    cleanup.push(root);
    const flowPath = path.join(root, 'demo.flow');
    await writeFile(flowPath, JSON.stringify({
        id: 'demo', draftVersion: 1, name: 'Demo',
        nodes: [{
            id: 'out', name: 'Out', plugin: 'builtin.transform', pluginVersion: '1.0.0',
            config: { operation: 'identity', outputName: 'result', type: 'text' },
            inputs: { input: 'hello' }, capabilities: [],
        }],
        edges: [], layout: {}, parameters: [], connections: [], updatedAt: 1,
    }), 'utf8');
    const code = await runCommand({ file: flowPath, profile: root, stateDir: path.join(root, 'state'), headless: true, json: true });
    expect(code).toBe(0);
    const runs = await import('node:fs/promises').then(fs => fs.readdir(path.join(root, 'state', 'runs')));
    expect(runs).toHaveLength(1);
    expect(await readFile(path.join(root, 'state', 'runs', runs[0], 'result.txt'), 'utf8')).toContain('hello');
});
