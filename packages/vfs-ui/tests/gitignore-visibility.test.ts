import { it, expect } from 'vitest';
import { createVFS, MemoryBackend } from '@itookit/vfs-core';
import { filterGitignoredFiles } from '../src/utils/gitignore-visibility';
import { fromVFS } from '../src/browser/from-vfs';

it('hides only gitignore matches in the UI while preserving raw file access', async () => {
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
    const fs = await manager.openFileSystem('/');
    try {
        for (const [path, content] of Object.entries({ '/project/keep.txt': '', '/project/drop.log': 'raw',
            '/project/node_modules/a.js': '', '/project/sub/keep.log': '', '/project/sub/drop.log': '' })) {
            const split = path.lastIndexOf('/');
            await fs.driver.createFile({ parentPath: path.slice(0, split), name: path.slice(split + 1), content, recursive: true });
        }
        const browser = fromVFS(fs, { root: '/project' });
        expect((await browser.children(null)).map(n => n.label)).toContain('node_modules');
        await fs.driver.createFile({ parentPath: '/project', name: '.gitignore', content: '*.log\nnode_modules/' });
        await fs.driver.createFile({ parentPath: '/project/sub', name: '.gitignore', content: '!keep.log' });
        const names = (await browser.children(null)).map(n => n.label);
        expect(names).toContain('keep.txt'); expect(names).not.toContain('drop.log'); expect(names).not.toContain('node_modules');
        expect((await browser.children('/project/sub')).map(n => n.label)).toContain('keep.log');
        expect((await browser.children('/project/sub')).map(n => n.label)).not.toContain('drop.log');
        expect(await fs.driver.readContent('/project/drop.log', { encoding: 'utf-8' })).toBe('raw');
        expect((await fs.driver.getChildren('/project')).some(n => n.name === 'drop.log')).toBe(true);
        expect((await filterGitignoredFiles(fs, await fs.driver.getChildren('/project/node_modules')))).toEqual([]);
        await fs.driver.writeContent('/project/.gitignore', '');
        expect((await browser.children(null)).map(n => n.label)).toContain('drop.log');
    } finally { await manager.dispose(); }
});

it('refreshes the visible tree on ignore changes and keeps rules within the browser root', async () => {
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
    const fs = await manager.openFileSystem('/');
    try {
        await fs.driver.createFile({ parentPath: '/', name: '.gitignore', content: '*.txt' });
        await fs.driver.createFile({ parentPath: '/project', name: 'visible.txt', content: '', recursive: true });
        const browser = fromVFS(fs, { root: '/project' });
        expect((await browser.children(null)).map(n => n.label)).toContain('visible.txt');
        const events: unknown[] = []; const stop = browser.subscribe!(event => events.push(event));
        await fs.driver.createFile({ parentPath: '/project', name: '.gitignore', content: '*.txt' });
        expect((await browser.children(null)).map(n => n.label)).not.toContain('visible.txt');
        expect(events).toContainEqual({}); stop();
    } finally { await manager.dispose(); }
});

it('does not inspect child directory rules before the child is expanded', async () => {
    const { manager } = await createVFS({ rootBackend: new MemoryBackend() });
    const fs = await manager.openFileSystem('/');
    try {
        await fs.driver.createDirectory({ parentPath: '/', name: 'child' });
        const original = fs.driver.getNodeType!.bind(fs.driver);
        fs.driver.getNodeType = async (path, options) => {
            if (path === '/child/.gitignore') throw new Error('Child rules require separate access');
            return original(path, options);
        };
        const raw = await fs.driver.getChildren('/');
        expect((await filterGitignoredFiles(fs, raw)).some(node => node.name === 'child')).toBe(true);
    } finally { await manager.dispose(); }
});
