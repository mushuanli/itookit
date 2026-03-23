/**
 * @file vfsdriver-fs/src/stores/fs-content-store.ts
 * @desc IContentStore backed by OS files in `.meta/content/<ref>`.
 *
 * Write strategy:
 *   1. Write data to `.meta/tmp/<ref>.tmp`
 *   2. datasync() the temp file
 *   3. rename() temp → `.meta/content/<ref>`   ← atomic on POSIX
 *
 * This guarantees that either the old or the new content is visible;
 * never a partially-written file.
 */

import { promises as fs } from 'node:fs';
import type { IContentStore } from '@itookit/common';
import { atomicWrite, atomicAppend, unlinkSafe, fileExists, contentPath, tmpPath } from '../utils/atomic-write';

export class FsContentStore implements IContentStore {
    constructor(
        private readonly contentDir: string,
        private readonly tmpDir: string,
    ) {}

    async putData(ref: string, data: ArrayBuffer): Promise<void> {
        await atomicWrite(
            tmpPath(this.tmpDir, ref),
            contentPath(this.contentDir, ref),
            data,
        );
    }

    async getData(ref: string): Promise<ArrayBuffer | null> {
        const filePath = contentPath(this.contentDir, ref);
        try {
            const buf = await fs.readFile(filePath);
            // Return a copy so callers cannot mutate our buffer
            return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
        } catch (e: unknown) {
            if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
            throw e;
        }
    }

    async deleteData(ref: string): Promise<void> {
        await unlinkSafe(contentPath(this.contentDir, ref));
    }

    async existsData(ref: string): Promise<boolean> {
        return fileExists(contentPath(this.contentDir, ref));
    }

    async sizeData(ref: string): Promise<number> {
        try {
            const stat = await fs.stat(contentPath(this.contentDir, ref));
            return stat.size;
        } catch {
            return 0;
        }
    }

    async readRange(ref: string, offset: number, length: number): Promise<ArrayBuffer | null> {
        const filePath = contentPath(this.contentDir, ref);
        let fh: fs.FileHandle | undefined;
        try {
            fh = await fs.open(filePath, 'r');
            const buf = Buffer.allocUnsafe(length);
            const { bytesRead } = await fh.read(buf, 0, length, offset);
            return buf.buffer.slice(0, bytesRead) as ArrayBuffer;
        } catch (e: unknown) {
            if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
            throw e;
        } finally {
            await fh?.close();
        }
    }

    async appendData(ref: string, data: ArrayBuffer): Promise<void> {
        await atomicAppend(
            tmpPath(this.tmpDir, ref),
            contentPath(this.contentDir, ref),
            data,
        );
    }
}
