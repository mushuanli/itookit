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
} from '@itookit/common';

export class FSMetaDriverAdapter implements IFSMetaDriver {
    readonly assets: IAssetOperations;
    readonly tags: ITagOperations;

    constructor(assets: IAssetOperations, tags: ITagOperations) {
        this.assets = assets;
        this.tags = tags;
    }
}
