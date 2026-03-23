/**
 * @file vfsdriver-fs/src/db/schema.ts
 * @desc SQLite DDL — single meta.db file for inodes, meta, inode_tags, records, counters.
 *
 * Design decisions:
 * - inode_tags is a materialised index of meta.tags (JSON) for O(log n) queryByTag
 * - ON DELETE CASCADE keeps the DB consistent when an inode is deleted
 * - metadata and extra are stored as JSON TEXT; only tags gets a dedicated table
 */

export const SCHEMA_VERSION = 1;

export const DDL = `
-- ── Schema version ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS _schema_version (
    version INTEGER PRIMARY KEY
);

-- ── Inode allocator counter ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS counters (
    name  TEXT    PRIMARY KEY,
    value INTEGER NOT NULL
);
INSERT OR IGNORE INTO counters (name, value) VALUES ('ino', 1);

-- ── Inodes ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inodes (
    ino       INTEGER PRIMARY KEY,
    parentIno INTEGER NOT NULL,
    name      TEXT    NOT NULL,
    type      TEXT    NOT NULL,
    createdAt INTEGER NOT NULL,
    nlink     INTEGER NOT NULL DEFAULT 1,
    UNIQUE (parentIno, name)
);
CREATE INDEX IF NOT EXISTS idx_inodes_parent ON inodes (parentIno);

-- ── Metadata ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS meta (
    ino             INTEGER PRIMARY KEY
                    REFERENCES inodes (ino) ON DELETE CASCADE,
    contentRef      TEXT,
    modifiedAt      INTEGER NOT NULL,
    size            INTEGER NOT NULL DEFAULT 0,
    version         INTEGER NOT NULL DEFAULT 0,
    contentHash     TEXT,
    mimeType        TEXT,
    icon            TEXT,
    symlinkTarget   TEXT,
    deviceHandlerId TEXT,
    assetDirIno     INTEGER,
    ownerFileIno    INTEGER,
    isAssetDir      INTEGER DEFAULT 0,
    tags            TEXT,       -- JSON array  e.g. ["work","urgent"]
    metadata        TEXT,       -- JSON object e.g. {"priority":1}
    extra           TEXT        -- JSON object, plugin-reserved
);
CREATE INDEX IF NOT EXISTS idx_meta_modified ON meta (modifiedAt);

-- ── Tag fast-lookup (materialised from meta.tags) ─────────────────────────────
CREATE TABLE IF NOT EXISTS inode_tags (
    ino INTEGER NOT NULL REFERENCES inodes (ino) ON DELETE CASCADE,
    tag TEXT    NOT NULL,
    PRIMARY KEY (ino, tag)
);
CREATE INDEX IF NOT EXISTS idx_inode_tags_tag ON inode_tags (tag);

-- ── SeqFile records ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS records (
    ino   INTEGER NOT NULL REFERENCES inodes (ino) ON DELETE CASCADE,
    field TEXT    NOT NULL,
    value TEXT    NOT NULL,     -- JSON-serialised RecordValue
    PRIMARY KEY (ino, field)
);
CREATE INDEX IF NOT EXISTS idx_records_ino ON records (ino);
`;

/** Applied once per connection, not per-schema-version. */
export const PRAGMAS = `
PRAGMA journal_mode  = WAL;
PRAGMA synchronous   = NORMAL;
PRAGMA foreign_keys  = ON;
PRAGMA cache_size    = -32000;
PRAGMA mmap_size     = 268435456;
PRAGMA temp_store    = MEMORY;
PRAGMA busy_timeout  = 5000;
`;
