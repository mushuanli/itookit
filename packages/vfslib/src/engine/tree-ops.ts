/**
 * @file packages/vfslib/src/engine/tree-ops.ts
 * @desc 树操作工具 — 递归删除、递归复制
 */

import type {
    IStorageBackend,
    IRecordStore,
    InodeRecord,
} from '@itookit/common';

type StoreAccessor = Pick<IStorageBackend, 'inodes' | 'meta' | 'content'> & {
    readonly records?: IRecordStore;
};

export async function deleteRecursive(
    store: StoreAccessor,
    ino: number,
): Promise<number[]> {
    const deleted: number[] = [];
    await deleteWalk(store, ino, deleted);
    return deleted;
}

async function deleteWalk(
    store: StoreAccessor,
    ino: number,
    deleted: number[],
): Promise<void> {
    const inode = await store.inodes.getInode(ino);
    if (!inode) return;

    if (inode.type === 'directory') {
        const children = await store.inodes.listChildren(ino);
        for (const child of children) {
            await deleteWalk(store, child.ino, deleted);
        }
    }

    const meta = await store.meta.getMeta(ino);
    if (meta?.contentRef) {
        await store.content.deleteData(meta.contentRef);
    }

    // Seqfile stores key-value data in the records table; clean it up to avoid orphans.
    if (inode.type === 'seqfile' && store.records) {
        await store.records.clearRecordFields(ino);
    }

    await store.meta.deleteMeta(ino);
    await store.inodes.deleteInode(ino);
    deleted.push(ino);
}

export async function copyRecursive(
    store: StoreAccessor,
    sourceIno: number,
    targetParentIno: number,
    newName: string,
): Promise<Map<number, number>> {
    const mapping = new Map<number, number>();
    await copyWalk(store, sourceIno, targetParentIno, newName, mapping);
    return mapping;
}

async function copyWalk(
    store: StoreAccessor,
    sourceIno: number,
    targetParentIno: number,
    name: string,
    mapping: Map<number, number>,
): Promise<number> {
    const sourceInode = await store.inodes.getInode(sourceIno);
    if (!sourceInode) {
        throw new Error(`Source inode ${sourceIno} not found`);
    }

    const sourceMeta = await store.meta.getMeta(sourceIno);
    const newIno = await store.inodes.allocateIno();
    mapping.set(sourceIno, newIno);

    const now = Date.now();

    const newInode: InodeRecord = {
        ino: newIno,
        parentIno: targetParentIno,
        name,
        type: sourceInode.type,
        createdAt: now,
        nlink: 1,
    };
    await store.inodes.putInode(newInode);

    let newContentRef: string | undefined;
    if (sourceMeta?.contentRef) {
        const data = await store.content.getData(sourceMeta.contentRef);
        if (data) {
            newContentRef = `data_${newIno}`;
            await store.content.putData(newContentRef, data);
        }
    }

    if (sourceMeta) {
        await store.meta.putMeta({
            ...sourceMeta,
            ino: newIno,
            contentRef: newContentRef,
            modifiedAt: now,
            version: 0,
        });
    }

    // Copy seqfile records to the new inode.
    if (sourceInode.type === 'seqfile' && store.records) {
        const entries = await store.records.getAllRecordFields(sourceIno);
        for (const [field, value] of Object.entries(entries)) {
            await store.records.setRecordField(newIno, field, value);
        }
    }

    if (sourceInode.type === 'directory') {
        const children = await store.inodes.listChildren(sourceIno);
        for (const child of children) {
            await copyWalk(store, child.ino, newIno, child.name, mapping);
        }
    }

    return newIno;
}
