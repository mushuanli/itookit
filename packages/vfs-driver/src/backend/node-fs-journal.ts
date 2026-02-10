// backend/node-fs-journal.ts
import type { StorageBackend } from '../interface/storage';
import type { Inode, DirEntry } from '../interface/types';
import type { NodeFSBackend } from './node-fs';

type JournalEntry =
  | { type: 'putInode'; ino: number; prev: Inode | null }
  | { type: 'deleteInode'; ino: number; prev: Inode | null }
  | { type: 'putData'; ref: string; prev: ArrayBuffer | null }
  | { type: 'deleteData'; ref: string; prev: ArrayBuffer | null }
  | { type: 'putDirEntry'; parentIno: number; name: string; prev: DirEntry[] }
  | { type: 'deleteDirEntry'; parentIno: number; name: string; prev: DirEntry[] };

export class TransactionJournal implements StorageBackend {
  readonly name = 'node-fs-txn';
  private journal: JournalEntry[] = [];

  constructor(private readonly real: NodeFSBackend) {}

  async init(): Promise<void> {}
  async close(): Promise<void> {}

  async getInode(ino: number): Promise<Inode | null> {
    return this.real.getInode(ino);
  }

  async putInode(inode: Inode): Promise<void> {
    const prev = await this.real.getInode(inode.ino);
    this.journal.push({ type: 'putInode', ino: inode.ino, prev });
    await this.real.putInode(inode);
  }

  async deleteInode(ino: number): Promise<void> {
    const prev = await this.real.getInode(ino);
    this.journal.push({ type: 'deleteInode', ino, prev });
    await this.real.deleteInode(ino);
  }

  async allocateIno(): Promise<number> {
    return this.real.allocateIno();
  }

  async getData(ref: string): Promise<ArrayBuffer | null> {
    return this.real.getData(ref);
  }

  async putData(ref: string, data: ArrayBuffer): Promise<void> {
    const prev = await this.real.getData(ref);
    this.journal.push({ type: 'putData', ref, prev });
    await this.real.putData(ref, data);
  }

  async deleteData(ref: string): Promise<void> {
    const prev = await this.real.getData(ref);
    this.journal.push({ type: 'deleteData', ref, prev });
    await this.real.deleteData(ref);
  }

  async getDirEntries(ino: number): Promise<DirEntry[]> {
    return this.real.getDirEntries(ino);
  }

  async putDirEntry(parentIno: number, entry: DirEntry): Promise<void> {
    const prev = await this.real.getDirEntries(parentIno);
    this.journal.push({
      type: 'putDirEntry', parentIno, name: entry.name, prev,
    });
    await this.real.putDirEntry(parentIno, entry);
  }

  async deleteDirEntry(parentIno: number, name: string): Promise<void> {
    const prev = await this.real.getDirEntries(parentIno);
    this.journal.push({ type: 'deleteDirEntry', parentIno, name, prev });
    await this.real.deleteDirEntry(parentIno, name);
  }

  async runInTransaction<T>(
    _mode: 'readonly' | 'readwrite',
    fn: (backend: StorageBackend) => Promise<T>,
  ): Promise<T> {
    return fn(this);
  }

  async commit(): Promise<void> {
    this.journal = [];
  }

  async rollback(): Promise<void> {
    for (let i = this.journal.length - 1; i >= 0; i--) {
      const entry = this.journal[i];
      try {
        await this.revertEntry(entry);
      } catch {
        // best-effort rollback
      }
    }
    this.journal = [];
  }

  private async revertEntry(entry: JournalEntry): Promise<void> {
    switch (entry.type) {
      case 'putInode':
        if (entry.prev) await this.real.putInode(entry.prev);
        else await this.real.deleteInode(entry.ino);
        break;
      case 'deleteInode':
        if (entry.prev) await this.real.putInode(entry.prev);
        break;
      case 'putData':
        if (entry.prev) await this.real.putData(entry.ref, entry.prev);
        else await this.real.deleteData(entry.ref);
        break;
      case 'deleteData':
        if (entry.prev) await this.real.putData(entry.ref, entry.prev);
        break;
      case 'putDirEntry':
      case 'deleteDirEntry':
        await this.restoreDirEntries(entry.parentIno, entry.prev);
        break;
    }
  }

  private async restoreDirEntries(
    parentIno: number,
    prev: DirEntry[],
  ): Promise<void> {
    const current = await this.real.getDirEntries(parentIno);
    for (const e of current) {
      await this.real.deleteDirEntry(parentIno, e.name);
    }
    for (const e of prev) {
      await this.real.putDirEntry(parentIno, e);
    }
  }
}
