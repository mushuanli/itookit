/**
 * @file vfslib/src/services/fs-driver-adapter.ts
 * @desc FSMetaDriverAdapter — groups ModuleFS capability sub-interfaces into IFSMetaDriver.
 *
 * v4.1: ModuleFS no longer exposes assets/tags/seq/refs/watcher at the top level.
 * FSMetaDriverAdapter now receives them directly in its constructor.
 */

import type {
    IFSMetaDriver,
    IAssetOperations,
    ITagOperations,
    ISeqFileOperations,
    IRefOperations,
} from '../protocol';

export class FSMetaDriverAdapter implements IFSMetaDriver {
    readonly assets: IAssetOperations;
    readonly tags: ITagOperations;
    readonly seq?: ISeqFileOperations;
    readonly refs?: IRefOperations;

    constructor(
        assets: IAssetOperations,
        tags: ITagOperations,
        seq?: ISeqFileOperations,
        refs?: IRefOperations,
    ) {
        this.assets = assets;
        this.tags = tags;
        this.seq = seq;
        this.refs = refs;
    }
}
