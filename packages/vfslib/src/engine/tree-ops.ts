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

type DeleteItem = { ino: number; type: string; contentRef?: string };

export async function deleteRecursive(
    store: StoreAccessor,
    ino: number,
): Promise<number[]> {
    const rootInode = await store.inodes.getInode(ino);
    if (!rootInode) return [];

    // Collect root + all descendants in DFS pre-order (parent before children).
    const items: DeleteItem[] = [];
    const rootMeta = await store.meta.getMeta(ino);
    items.push({ ino, type: rootInode.type, contentRef: rootMeta?.contentRef });

    await store.inodes.walkTree(ino, async (inode) => {
        const meta = await store.meta.getMeta(inode.ino);
        items.push({ ino: inode.ino, type: inode.type, contentRef: meta?.contentRef });
        return true;
    }, { maxDepth: -1 });

    // Reverse so children are deleted before their parent.
    items.reverse();

    const deleted: number[] = [];
    for (const item of items) {
        if (item.contentRef) {
            await store.content.deleteData(item.contentRef);
        }
        // Seqfile stores key-value data in the records table; clean it up to avoid orphans.
        if (item.type === 'seqfile' && store.records) {
            await store.records.clearRecordFields(item.ino);
        }
        await store.meta.deleteMeta(item.ino);
        await store.inodes.deleteInode(item.ino);
        deleted.push(item.ino);
    }

    return deleted;
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
        await store.records.walkRecordFields(sourceIno, async (field, value) => {
            await store.records!.setRecordField(newIno, field, value);
            return true;
        });
    }

    if (sourceInode.type === 'directory') {
        const children: InodeRecord[] = [];
        await store.inodes.walkTree(sourceIno, async (inode, depth) => {
            if (depth === 0) { children.push(inode); return 'skip'; }
            return false;
        }, { maxDepth: 0 });
        for (const child of children) {
            await copyWalk(store, child.ino, newIno, child.name, mapping);
        }
    }

    return newIno;
}
