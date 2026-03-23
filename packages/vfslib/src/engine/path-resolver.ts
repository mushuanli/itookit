/**
 * @file packages/vfslib/src/engine/path-resolver.ts
 * @desc 路径解析引擎
 */

import type {
    IStorageBackend,
    InodeRecord,
    MetaRecord,
} from '@itookit/common';

import {
    FSNotFoundError,
    FSSymlinkLoopError,
    FSError,
    DEFAULT_MAX_SYMLINK_DEPTH,
} from '@itookit/common';

import * as pathUtils from '../utils/path';

export interface ResolvedInode {
    readonly inode: InodeRecord;
    readonly meta: MetaRecord | null;
    readonly ino: number;
    readonly parentIno: number;
    readonly name: string;
    readonly fullPath: string;
}

type StoreAccessor = Pick<IStorageBackend, 'inodes' | 'meta'>;

export class PathResolver {
    constructor(
        private readonly maxSymlinkDepth: number = DEFAULT_MAX_SYMLINK_DEPTH,
    ) {}

    async resolve(
        store: StoreAccessor,
        rootIno: number,
        path: string,
        followLastSymlink = true,
    ): Promise<ResolvedInode> {
        return this.resolveInternal(store, rootIno, path, followLastSymlink, 0);
    }

    async tryResolve(
        store: StoreAccessor,
        rootIno: number,
        path: string,
        followLastSymlink = true,
    ): Promise<ResolvedInode | null> {
        try {
            return await this.resolve(store, rootIno, path, followLastSymlink);
        } catch (e) {
            if (e instanceof FSNotFoundError) return null;
            throw e;
        }
    }

    private async resolveInternal(
        store: StoreAccessor,
        rootIno: number,
        path: string,
        followLastSymlink: boolean,
        symlinkCount: number,
    ): Promise<ResolvedInode> {
        if (symlinkCount > this.maxSymlinkDepth) {
            throw new FSSymlinkLoopError(path);
        }

        const segs = pathUtils.segments(pathUtils.normalize(path));

        const rootInode = await this.getInode(store, rootIno);
        if (segs.length === 0) {
            const rootMeta = await store.meta.getMeta(rootIno);
            return {
                inode: rootInode,
                meta: rootMeta,
                ino: rootIno,
                parentIno: rootIno,
                name: '',
                fullPath: '/',
            };
        }

        let currentIno = rootIno;
        let currentInode = rootInode;
        let parentIno = rootIno;
        let builtPath = '/';

        for (let i = 0; i < segs.length; i++) {
            const seg = segs[i];
            const isLast = i === segs.length - 1;

            if (currentInode.type !== 'directory') {
                throw new FSError('ENOTDIR', `not a directory: ${builtPath}`, 'resolve', builtPath);
            }

            const child = await store.inodes.lookup(currentIno, seg);
            if (!child) {
                throw new FSNotFoundError(pathUtils.join(builtPath, seg), 'resolve');
            }

            parentIno = currentIno;
            currentIno = child.ino;
            currentInode = child;
            builtPath = pathUtils.join(builtPath, seg);

            const shouldFollow = isLast ? followLastSymlink : true;
            if (currentInode.type === 'symlink' && shouldFollow) {
                const meta = await store.meta.getMeta(currentIno);
                const target = meta?.symlinkTarget;
                if (!target) {
                    throw new FSError('EIO', 'symlink has no target', 'resolve', builtPath);
                }

                const resolvedTarget = target.startsWith('/')
                    ? target
                    : pathUtils.join(pathUtils.dirname(builtPath), target);

                const remaining = segs.slice(i + 1);
                const fullTarget = remaining.length > 0
                    ? pathUtils.join(resolvedTarget, ...remaining)
                    : resolvedTarget;

                return this.resolveInternal(
                    store,
                    rootIno,
                    fullTarget,
                    followLastSymlink,
                    symlinkCount + 1,
                );
            }
        }

        const meta = await store.meta.getMeta(currentIno);
        return {
            inode: currentInode,
            meta,
            ino: currentIno,
            parentIno,
            name: segs[segs.length - 1],
            fullPath: builtPath,
        };
    }

    private async getInode(store: StoreAccessor, ino: number): Promise<InodeRecord> {
        const inode = await store.inodes.getInode(ino);
        if (!inode) {
            throw new FSError('EIO', `inode ${ino} not found in store`, 'resolve');
        }
        return inode;
    }
}
