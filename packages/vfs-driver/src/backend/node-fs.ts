// @vfs-driver/backend/node-fs.ts

import type { StorageBackend } from '../interface/storage';
import type { Inode, DirEntry } from '../interface/types';
import { FileType } from '../interface/types';
import { createInode } from '../core/inode';
import { FileSystemError } from '../core/errors';
import { TransactionJournal } from './node-fs-journal';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface NodeFSConfig {
  rootPath: string;
}

export class NodeFSBackend implements StorageBackend {
  readonly name = 'node-fs';

  //private readonly rootPath: string;
  private readonly inodesDir: string;
  private readonly dataDir: string;
  private readonly dirsDir: string;
  private readonly metaFile: string;

  constructor(config: NodeFSConfig) {
    //this.rootPath = config.rootPath;
    const vfsDir = path.join(config.rootPath, '.vfs');
    this.inodesDir = path.join(vfsDir, 'inodes');
    this.dataDir = path.join(vfsDir, 'data');
    this.dirsDir = path.join(vfsDir, 'dirs');
    this.metaFile = path.join(vfsDir, 'meta.json');
  }

  async init(): Promise<void> {
    await fs.mkdir(this.inodesDir, { recursive: true });
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.mkdir(this.dirsDir, { recursive: true });

    // 确保 meta 文件存在
    try {
      await fs.access(this.metaFile);
    } catch {
      await this.writeMeta({ nextIno: 2 });
    }

    // 确保根目录 inode 存在
    const root = await this.getInode(1);
    if (!root) {
      const rootInode = createInode(1, FileType.DIRECTORY);
      await this.putInode(rootInode);
      await this.writeDirEntries(1, []);
    }
  }

  async close(): Promise<void> {
    // Node.js FS 无需显式关闭
  }

  // ---- Inode ----

  async getInode(ino: number): Promise<Inode | null> {
    try {
      const raw = await fs.readFile(this.inodePath(ino), 'utf-8');
      return JSON.parse(raw) as Inode;
    } catch (err: any) {
      if (err.code === 'ENOENT') return null;
      throw new FileSystemError('EIO', String(ino), err.message);
    }
  }

  async putInode(inode: Inode): Promise<void> {
    await fs.writeFile(this.inodePath(inode.ino), JSON.stringify(inode), 'utf-8');
  }

  async deleteInode(ino: number): Promise<void> {
    try {
      await fs.unlink(this.inodePath(ino));
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        throw new FileSystemError('EIO', String(ino), err.message);
      }
    }
  }

  async allocateIno(): Promise<number> {
    const meta = await this.readMeta();
    const ino = meta.nextIno;
    meta.nextIno = ino + 1;
    await this.writeMeta(meta);
    return ino;
  }

  // ---- Data ----

  async getData(ref: string): Promise<ArrayBuffer | null> {
    try {
      const buf = await fs.readFile(this.dataPath(ref));
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    } catch (err: any) {
      if (err.code === 'ENOENT') return null;
      throw new FileSystemError('EIO', ref, err.message);
    }
  }

  async putData(ref: string, data: ArrayBuffer): Promise<void> {
    await fs.writeFile(this.dataPath(ref), Buffer.from(data));
  }

  async deleteData(ref: string): Promise<void> {
    try {
      await fs.unlink(this.dataPath(ref));
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        throw new FileSystemError('EIO', ref, err.message);
      }
    }
  }

  // ---- DirEntry ----

  async getDirEntries(ino: number): Promise<DirEntry[]> {
    try {
      const raw = await fs.readFile(this.dirPath(ino), 'utf-8');
      return JSON.parse(raw) as DirEntry[];
    } catch (err: any) {
      if (err.code === 'ENOENT') return [];
      throw new FileSystemError('EIO', String(ino), err.message);
    }
  }

  async putDirEntry(parentIno: number, entry: DirEntry): Promise<void> {
    const entries = await this.getDirEntries(parentIno);
    const idx = entries.findIndex((e) => e.name === entry.name);
    if (idx >= 0) {
      entries[idx] = entry;
    } else {
      entries.push(entry);
    }
    await this.writeDirEntries(parentIno, entries);
  }

  async deleteDirEntry(parentIno: number, name: string): Promise<void> {
    const entries = await this.getDirEntries(parentIno);
    const filtered = entries.filter((e) => e.name !== name);
    await this.writeDirEntries(parentIno, filtered);
  }

  // ---- 事务（操作日志 + 补偿） ----

  async runInTransaction<T>(
    mode: 'readonly' | 'readwrite',
    fn: (backend: StorageBackend) => Promise<T>,
  ): Promise<T> {
    if (mode === 'readonly') {
      return fn(this);
    }

    // readwrite: 使用日志型代理
    const journal = new TransactionJournal(this);
    try {
      const result = await fn(journal);
      await journal.commit();
      return result;
    } catch (err) {
      await journal.rollback();
      throw err;
    }
  }

  // ---- 内部帮助 ----

  private inodePath(ino: number): string {
    return path.join(this.inodesDir, `${ino}.json`);
  }

  private dataPath(ref: string): string {
    // 安全文件名
    const safe = ref.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.dataDir, `${safe}.bin`);
  }

  private dirPath(ino: number): string {
    return path.join(this.dirsDir, `${ino}.json`);
  }

  private async readMeta(): Promise<{ nextIno: number }> {
    const raw = await fs.readFile(this.metaFile, 'utf-8');
    return JSON.parse(raw);
  }

  private async writeMeta(meta: { nextIno: number }): Promise<void> {
    await fs.writeFile(this.metaFile, JSON.stringify(meta), 'utf-8');
  }

  private async writeDirEntries(ino: number, entries: DirEntry[]): Promise<void> {
    await fs.writeFile(this.dirPath(ino), JSON.stringify(entries), 'utf-8');
  }
}
