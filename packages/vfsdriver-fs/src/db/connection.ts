/**
 * @file vfsdriver-fs/src/db/connection.ts
 * @desc Open, configure, and migrate the single meta.db SQLite database.
 */

import Database from 'better-sqlite3';
import { DDL, PRAGMAS, SCHEMA_VERSION } from './schema';
import { applyMigrations } from './migrations';

export function openDatabase(dbPath: string): Database.Database {
    const db = new Database(dbPath);

    // Apply connection-level settings first
    db.exec(PRAGMAS);

    // Create tables if they do not exist
    db.exec(DDL);

    // Schema versioning
    const row = db.prepare('SELECT version FROM _schema_version').get() as
        | { version: number }
        | undefined;

    const currentVersion = row?.version ?? 0;

    if (currentVersion === 0) {
        // Fresh database — stamp version without running migrations
        db.prepare('INSERT OR REPLACE INTO _schema_version (version) VALUES (?)').run(
            SCHEMA_VERSION,
        );
    } else if (currentVersion < SCHEMA_VERSION) {
        applyMigrations(db, currentVersion, SCHEMA_VERSION);
    } else if (currentVersion > SCHEMA_VERSION) {
        throw new Error(
            `Database schema version ${currentVersion} is newer than ` +
            `driver version ${SCHEMA_VERSION}. Please upgrade @itookit/vfsdriver-fs.`,
        );
    }

    return db;
}

/** Graceful shutdown: checkpoint WAL then close. */
export function closeDatabase(db: Database.Database): void {
    try {
        db.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
        // Best-effort — ignore if DB is already in a bad state
    }
    db.close();
}
