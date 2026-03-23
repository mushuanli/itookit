/**
 * @file vfsdriver-fs/src/db/migrations.ts
 * @desc Schema version management.
 *
 * Each entry in MIGRATIONS is a function that upgrades FROM that index version.
 * Index 0 → run[0] → version 1, index 1 → run[1] → version 2, …
 */

import type Database from 'better-sqlite3';

// Each migration function receives the DB and should apply changes atomically.
type MigrationFn = (db: Database.Database) => void;

/** Add new entries here when the schema changes. */
const MIGRATIONS: MigrationFn[] = [
    // 0 → 1: initial schema (handled by DDL in connection.ts)
    (_db) => { /* no-op; DDL already ran */ },
];

export function applyMigrations(db: Database.Database, currentVersion: number, targetVersion: number): void {
    for (let v = currentVersion; v < targetVersion; v++) {
        const migrate = MIGRATIONS[v];
        if (!migrate) throw new Error(`No migration defined from version ${v} to ${v + 1}`);
        db.transaction(() => {
            migrate(db);
            db.prepare('DELETE FROM _schema_version').run();
            db.prepare('INSERT INTO _schema_version (version) VALUES (?)').run(v + 1);
        })();
    }
}
