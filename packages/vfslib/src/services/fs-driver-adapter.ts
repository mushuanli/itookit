/**
 * @file vfslib/src/services/fs-driver-adapter.ts
 * @desc FSMetaDriverAdapter — combines capability sub-interfaces into IFSMetaDriver.
 *
 * Note: FSDriverAdapter was removed in v4.0 — ModuleFS now directly implements IFSDriver
 * (self-reference: ModuleFS.driver = this). This file only contains FSMetaDriverAdapter.
 */

import type {
    IFSMetaDriver,
    IAssetOperations,
    ITagOperations,
    ISeqFileOperations,
    IRefOperations,
    IWatchOperations,
} from '@itookit/common';
import type { ModuleFS } from './module-fs';

// ═══════════════════════════════════════════════════════════════
// FSMetaDriverAdapter
// ═══════════════════════════════════════════════════════════════

export class FSMetaDriverAdapter implements IFSMetaDriver {
    readonly assets: IAssetOperations;
    readonly tags: ITagOperations;
    readonly seq?: ISeqFileOperations;
    readonly refs?: IRefOperations;
    readonly watcher?: IWatchOperations;

    constructor(fs: ModuleFS) {
        this.assets = fs.assets;
        this.tags = fs.tags;
        this.seq = fs.seq;
        this.refs = fs.refs;
        this.watcher = fs.watcher;
    }
}
