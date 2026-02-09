// core/helper/record-ops.ts
import type {
  FileStat,
  Inode,
  RecordValue,
  RecordFileOptions,
  RecordQuery,
  RecordQueryOptions,
  RecordQueryResult,
} from '../../interface/types';
import { FileType } from '../../interface/types';
import { isRecordBackend } from '../../interface/storage';
import { FileSystemError } from '../errors';
import { PathUtils } from '../path';
import { createInode, inodeToStat } from '../inode';
import { FallbackRecordOps } from './fallback-record';
import type { FSContext } from './types';

export class RecordOps {
  constructor(private readonly ctx: FSContext) {}

  async createRecord(
    path: string,
    initialFields?: Record<string, RecordValue>,
    options?: RecordFileOptions & { recursive?: boolean },
  ): Promise<FileStat> {
    const norm = PathUtils.normalize(path);

    if (norm === '/dev' || norm.startsWith('/dev/')) {
      throw new FileSystemError('EACCES', norm, 'Cannot create record file on device path');
    }

    const { backend, subPath } = this.ctx.resolveBackend(norm);

    if (options?.recursive) {
      const parentDir = PathUtils.dirname(norm);
      if (parentDir !== '/') {
        await this.ensureParentDir(parentDir);
      }
    }

    const { parentInode, childName } =
      await this.ctx.pathResolver.resolveParent(subPath, backend);

    const existingEntries = await backend.getDirEntries(parentInode.ino);
    if (existingEntries.some((e) => e.name === childName)) {
      throw new FileSystemError('EEXIST', norm);
    }

    const ino = await backend.allocateIno();
    const inode = createInode(ino, FileType.RECORD, options?.metadata);
    inode.dataRef = `record-${ino}`;
    inode.recordIndexes = options?.indexes ? [...options.indexes] : [];

    const fields = initialFields ?? {};
    inode.size = Object.keys(fields).length;

    if (isRecordBackend(backend)) {
      await backend.setAllRecordFields(ino, fields);
      for (const indexField of inode.recordIndexes) {
        await backend.createRecordIndex(ino, indexField);
      }
    } else {
      await new FallbackRecordOps(backend).save(ino, fields);
    }

    await backend.putInode(inode);
    await backend.putDirEntry(parentInode.ino, { name: childName, ino });

    this.ctx.pathResolver.invalidate(PathUtils.dirname(norm));
    this.ctx.emitEvent('create', norm);
    return inodeToStat(inode);
  }

  async getField(
    path: string,
    field: string,
  ): Promise<RecordValue | undefined> {
    const { backend, inode } = await this.resolveRecord(path);

    if (isRecordBackend(backend)) {
      return backend.getRecordField(inode.ino, field);
    }
    return new FallbackRecordOps(backend).getField(inode.ino, field);
  }

  async setField(
    path: string,
    field: string,
    value: RecordValue,
  ): Promise<void> {
    const norm = PathUtils.normalize(path);
    const { backend, inode } = await this.resolveRecord(path);

    if (isRecordBackend(backend)) {
      await backend.setRecordField(inode.ino, field, value);
    } else {
      await new FallbackRecordOps(backend).setField(inode.ino, field, value);
    }

    await this.updateRecordSize(backend, inode);
    inode.modifiedAt = Date.now();
    await backend.putInode(inode);

    this.ctx.emitEvent('modify', norm, undefined, field);
  }

  async deleteField(path: string, field: string): Promise<void> {
    const norm = PathUtils.normalize(path);
    const { backend, inode } = await this.resolveRecord(path);

    if (isRecordBackend(backend)) {
      await backend.deleteRecordField(inode.ino, field);
    } else {
      await new FallbackRecordOps(backend).deleteField(inode.ino, field);
    }

    await this.updateRecordSize(backend, inode);
    inode.modifiedAt = Date.now();
    await backend.putInode(inode);

    this.ctx.emitEvent('modify', norm, undefined, field);
  }

  async getAllFields(
    path: string,
  ): Promise<Record<string, RecordValue>> {
    const { backend, inode } = await this.resolveRecord(path);

    if (isRecordBackend(backend)) {
      return backend.getAllRecordFields(inode.ino);
    }
    return new FallbackRecordOps(backend).load(inode.ino);
  }

  async setAllFields(
    path: string,
    fields: Record<string, RecordValue>,
  ): Promise<void> {
    const norm = PathUtils.normalize(path);
    const { backend, inode } = await this.resolveRecord(path);

    if (isRecordBackend(backend)) {
      await backend.setAllRecordFields(inode.ino, fields);
    } else {
      await new FallbackRecordOps(backend).save(inode.ino, fields);
    }

    inode.size = Object.keys(fields).length;
    inode.modifiedAt = Date.now();
    await backend.putInode(inode);

    this.ctx.emitEvent('modify', norm);
  }

  async listFields(path: string): Promise<string[]> {
    const { backend, inode } = await this.resolveRecord(path);

    if (isRecordBackend(backend)) {
      return backend.listRecordFields(inode.ino);
    }
    return new FallbackRecordOps(backend).listFields(inode.ino);
  }

  async queryFields(
    path: string,
    query: RecordQuery,
    options?: RecordQueryOptions,
  ): Promise<RecordQueryResult[]> {
    //const norm = PathUtils.normalize(path);
    const { backend, inode } = await this.resolveRecord(path);

    inode.accessedAt = Date.now();
    await backend.putInode(inode);

    if (isRecordBackend(backend)) {
      return backend.queryRecordFields(inode.ino, query, options);
    }
    return new FallbackRecordOps(backend).query(inode.ino, query, options);
  }

  async createIndex(path: string, field: string): Promise<void> {
    //const norm = PathUtils.normalize(path);
    const { backend, inode } = await this.resolveRecord(path);

    if (!inode.recordIndexes) inode.recordIndexes = [];
    if (inode.recordIndexes.includes(field)) return;

    inode.recordIndexes.push(field);
    inode.modifiedAt = Date.now();
    await backend.putInode(inode);

    if (isRecordBackend(backend)) {
      await backend.createRecordIndex(inode.ino, field);
    }
  }

  async deleteIndex(path: string, field: string): Promise<void> {
    //const norm = PathUtils.normalize(path);
    const { backend, inode } = await this.resolveRecord(path);

    if (!inode.recordIndexes) return;
    const idx = inode.recordIndexes.indexOf(field);
    if (idx < 0) return;

    inode.recordIndexes.splice(idx, 1);
    inode.modifiedAt = Date.now();
    await backend.putInode(inode);

    if (isRecordBackend(backend)) {
      await backend.deleteRecordIndex(inode.ino, field);
    }
  }

  // ---- 私有辅助 ----

  /**
   * 解析路径并断言为 Record 类型，返回后端和 inode
   * 消除每个方法中的重复样板代码
   */
  private async resolveRecord(
    path: string,
  ): Promise<{ backend: import('../../interface/storage').StorageBackend; inode: Inode }> {
    const norm = PathUtils.normalize(path);
    const { backend, subPath } = this.ctx.resolveBackend(norm);
    const { inode } = await this.ctx.pathResolver.resolve(subPath, backend);

    if (inode.type !== FileType.RECORD) {
      throw new FileSystemError('ENOTRECORD', norm, 'Not a record file');
    }

    return { backend, inode };
  }

  private async updateRecordSize(
    backend: import('../../interface/storage').StorageBackend,
    inode: Inode,
  ): Promise<void> {
    let fields: string[];
    if (isRecordBackend(backend)) {
      fields = await backend.listRecordFields(inode.ino);
    } else {
      fields = await new FallbackRecordOps(backend).listFields(inode.ino);
    }
    inode.size = fields.length;
  }

  private async ensureParentDir(parentDir: string): Promise<void> {
    const { backend, subPath } = this.ctx.resolveBackend(parentDir);
    try {
      await this.ctx.pathResolver.resolve(subPath, backend);
    } catch (err) {
      if (err instanceof FileSystemError && err.code === 'ENOENT') {
        const { DirOps } = await import('./dir-ops');
        const dirOps = new DirOps(this.ctx);
        await dirOps.mkdir(parentDir, { recursive: true });
      } else {
        throw err;
      }
    }
  }
}
