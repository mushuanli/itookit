/**
 * @file packages/vfslib/src/engine/node-mapper.ts
 * @desc InodeRecord + MetaRecord → FSNode 映射
 */

import type {
    FSNode,
    FSFileNode,
    FSDirectoryNode,
    FSSeqFileNode,
    FSDeviceNode,
    FSSymlinkNode,
    InodeRecord,
    MetaRecord,
} from '@itookit/common';

export function toFSNode(
    inode: InodeRecord,
    meta: MetaRecord | null,
    id: string,
    parentId: string | null,
    path: string,
): FSNode {
    const base = {
        id,
        parentId,
        name: inode.name,
        createdAt: inode.createdAt,
        modifiedAt: meta?.modifiedAt ?? inode.createdAt,
        path,
        version: meta?.version ?? 0,
        nlink: inode.nlink,
        tags: Object.freeze(meta?.tags ?? []) as readonly string[],
        metadata: Object.freeze(meta?.metadata ?? {}),
        icon: meta?.icon,
        mimeType: meta?.mimeType,
    };

    switch (inode.type) {
        case 'file':
            return Object.freeze<FSFileNode>({
                ...base,
                type: 'file',
                size: meta?.size ?? 0,
                contentHash: meta?.contentHash,
                assetDirId: meta?.assetDirIno?.toString(),
            });

        case 'directory':
            return Object.freeze<FSDirectoryNode>({
                ...base,
                type: 'directory',
            });

        case 'seqfile':
            return Object.freeze<FSSeqFileNode>({
                ...base,
                type: 'seqfile',
                assetDirId: meta?.assetDirIno?.toString(),
            });

        case 'device':
            return Object.freeze<FSDeviceNode>({
                ...base,
                type: 'device',
                deviceHandlerId: meta?.deviceHandlerId ?? '',
            });

        case 'symlink':
            return Object.freeze<FSSymlinkNode>({
                ...base,
                type: 'symlink',
                symlinkTarget: meta?.symlinkTarget ?? '',
            });

        default:
            throw new Error(`Unknown inode type: ${inode.type}`);
    }
}
