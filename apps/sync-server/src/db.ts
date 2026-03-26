import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';

export interface FileMeta {
  path: string;
  hash: string;
  mtime: number;
  is_deleted: number; // SQLite stores booleans as 0/1
  updated_at: number;
}

const blobsDir = join(config.dataDir, 'blobs');
mkdirSync(blobsDir, { recursive: true });

const db = new Database(join(config.dataDir, 'meta.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS files (
    path       TEXT PRIMARY KEY,
    hash       TEXT NOT NULL,
    mtime      INTEGER NOT NULL,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  )
`);

const stmtAll = db.prepare<[], FileMeta>('SELECT * FROM files');
const stmtGet = db.prepare<[string], FileMeta>('SELECT * FROM files WHERE path = ?');
const stmtUpsert = db.prepare<[string, string, number, number, number]>(
  'INSERT OR REPLACE INTO files (path, hash, mtime, is_deleted, updated_at) VALUES (?, ?, ?, ?, ?)',
);

export const getAllFiles = (): FileMeta[] => stmtAll.all();

export const getFile = (path: string): FileMeta | undefined => stmtGet.get(path);

export function upsertFile(path: string, hash: string, mtime: number, is_deleted = false): void {
  stmtUpsert.run(path, hash, mtime, is_deleted ? 1 : 0, Date.now());
}

// Content-addressed blob storage: blobs/{hash[0:2]}/{hash}
export function blobFilePath(hash: string): string {
  return join(blobsDir, hash.slice(0, 2), hash);
}

export function writeBlob(hash: string, buf: Buffer): void {
  const dir = join(blobsDir, hash.slice(0, 2));
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, hash);
  if (!existsSync(dest)) {
    writeFileSync(dest, buf); // skip if same content already stored
  }
}

export function readBlob(hash: string): Buffer {
  return readFileSync(blobFilePath(hash));
}
