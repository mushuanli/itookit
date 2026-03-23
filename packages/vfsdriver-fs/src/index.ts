/**
 * @file vfsdriver-fs/src/index.ts
 * @desc @itookit/vfsdriver-fs — OS filesystem VFS storage backend
 *
 * Storage layout:
 *   <rootDir>/.meta/meta.db       — SQLite: inodes, metadata, tags, SeqFile records
 *   <rootDir>/.meta/content/<ino> — Binary content files
 *   <rootDir>/.meta/tmp/          — Temporary files for atomic writes
 *
 * Usage:
 *   import { openFsBackend } from '@itookit/vfsdriver-fs';
 *   import { createVFS }     from '@itookit/vfslib';
 *
 *   const vfs = await createVFS({
 *     rootBackend: await openFsBackend({ rootDir: '/data/my-vault' }),
 *   });
 */

export { FsBackend, openFsBackend, type FsBackendOptions } from './fs-backend';

// Store implementations (useful for custom wiring or testing)
export { FsInodeStore }   from './stores/fs-inode-store';
export { FsMetaStore }    from './stores/fs-meta-store';
export { FsContentStore } from './stores/fs-content-store';
export { FsRecordStore }  from './stores/fs-record-store';

// DB utilities
export { openDatabase, closeDatabase } from './db/connection';
export { SCHEMA_VERSION, DDL, PRAGMAS } from './db/schema';

// Filesystem utilities
export {
    atomicWrite,
    atomicAppend,
    unlinkSafe,
    fileExists,
    ensureDir,
    contentPath,
    tmpPath,
} from './utils/atomic-write';

export {
    cleanTmpFiles,
    verifyContentRefs,
    gcOrphanedContent,
} from './utils/startup';
