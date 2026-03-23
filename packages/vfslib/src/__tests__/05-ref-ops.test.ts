/**
 * Reference (bidirectional link) operations:
 * addRef, removeRef, getOutgoing, getIncoming, hasRef, syncOutgoing.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupVFS, type TestVFS } from './helpers';

describe('Reference operations (IndexedDB backend)', () => {
    let vfs: TestVFS;
    beforeEach(async () => { vfs = await setupVFS(); });
    afterEach(async () => { await vfs.dispose(); });

    async function mkFile(name: string) {
        await vfs.fs.createFile({ name, parentIdOrPath: null, content: '' });
        return `/${name}`;
    }

    it('addRef creates outgoing ref on source', async () => {
        const src = await mkFile('src.md');
        const tgt = await mkFile('tgt.md');
        await vfs.fs.refs!.addRef(src, tgt, 'mention');
        const out = await vfs.fs.refs!.getOutgoing(src);
        expect(out).toHaveLength(1);
        expect(out[0].refType).toBe('mention');
    });

    it('addRef creates incoming ref on target', async () => {
        const src = await mkFile('s.md');
        const tgt = await mkFile('t.md');
        await vfs.fs.refs!.addRef(src, tgt, 'depend');
        const inc = await vfs.fs.refs!.getIncoming(tgt);
        expect(inc).toHaveLength(1);
        expect(inc[0].refType).toBe('depend');
    });

    it('addRef is idempotent', async () => {
        const src = await mkFile('i1.md');
        const tgt = await mkFile('i2.md');
        await vfs.fs.refs!.addRef(src, tgt, 'related');
        await vfs.fs.refs!.addRef(src, tgt, 'related');
        const out = await vfs.fs.refs!.getOutgoing(src);
        expect(out.filter(r => r.refType === 'related')).toHaveLength(1);
    });

    it('hasRef returns true when ref exists', async () => {
        const src = await mkFile('h1.md');
        const tgt = await mkFile('h2.md');
        await vfs.fs.refs!.addRef(src, tgt, 'embed');
        expect(await vfs.fs.refs!.hasRef(src, tgt, 'embed')).toBe(true);
    });

    it('hasRef returns false for different refType', async () => {
        const src = await mkFile('x1.md');
        const tgt = await mkFile('x2.md');
        await vfs.fs.refs!.addRef(src, tgt, 'mention');
        expect(await vfs.fs.refs!.hasRef(src, tgt, 'depend')).toBe(false);
    });

    it('removeRef deletes the link from both sides', async () => {
        const src = await mkFile('r1.md');
        const tgt = await mkFile('r2.md');
        await vfs.fs.refs!.addRef(src, tgt, 'mention');
        await vfs.fs.refs!.removeRef(src, tgt, 'mention');
        expect(await vfs.fs.refs!.hasRef(src, tgt, 'mention')).toBe(false);
        expect(await vfs.fs.refs!.getIncoming(tgt)).toHaveLength(0);
    });

    it('getOutgoing filters by refType', async () => {
        const src = await mkFile('fo1.md');
        const t1 = await mkFile('fo2.md');
        const t2 = await mkFile('fo3.md');
        await vfs.fs.refs!.addRef(src, t1, 'mention');
        await vfs.fs.refs!.addRef(src, t2, 'depend');
        const mentions = await vfs.fs.refs!.getOutgoing(src, { refTypes: ['mention'] });
        expect(mentions).toHaveLength(1);
        expect(mentions[0].refType).toBe('mention');
    });

    it('syncOutgoing replaces all outgoing refs atomically', async () => {
        const src = await mkFile('so1.md');
        const t1 = await mkFile('so2.md');
        const t2 = await mkFile('so3.md');
        const t3 = await mkFile('so4.md');
        await vfs.fs.refs!.addRef(src, t1, 'mention');
        await vfs.fs.refs!.addRef(src, t2, 'mention');
        await vfs.fs.refs!.syncOutgoing(src, [
            { targetIdOrPath: t3, refType: 'mention' },
        ]);
        const out = await vfs.fs.refs!.getOutgoing(src);
        expect(out).toHaveLength(1);
        expect(await vfs.fs.refs!.hasRef(src, t3, 'mention')).toBe(true);
        expect(await vfs.fs.refs!.hasRef(src, t1, 'mention')).toBe(false);
    });

    it('extra payload is stored on ref', async () => {
        const src = await mkFile('ep1.md');
        const tgt = await mkFile('ep2.md');
        await vfs.fs.refs!.addRef(src, tgt, 'related', { anchor: 'section-1' });
        const out = await vfs.fs.refs!.getOutgoing(src);
        expect(out[0].extra?.anchor).toBe('section-1');
    });

    it('node with no refs returns empty arrays', async () => {
        const p = await mkFile('solo.md');
        expect(await vfs.fs.refs!.getOutgoing(p)).toHaveLength(0);
        expect(await vfs.fs.refs!.getIncoming(p)).toHaveLength(0);
    });
});
