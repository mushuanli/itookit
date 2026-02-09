// core/helper/fallback-record.ts
import type { StorageBackend } from '../../interface/storage';
import type {
  RecordValue,
  RecordQuery,
  RecordQueryOptions,
  RecordQueryResult,
} from '../../interface/types';
import { extractFieldValue, matchesQuery } from './record-query';

/**
 * 当后端不支持 RecordBackend 时的退化实现
 * 将记录字段序列化为 JSON 存储在 getData/putData 中
 */
export class FallbackRecordOps {
  constructor(private backend: StorageBackend) {}

  private ref(ino: number): string {
    return `record-${ino}`;
  }

  async load(ino: number): Promise<Record<string, RecordValue>> {
    const data = await this.backend.getData(this.ref(ino));
    if (!data || data.byteLength === 0) return {};
    return JSON.parse(new TextDecoder().decode(data));
  }

  async save(
    ino: number,
    fields: Record<string, RecordValue>,
  ): Promise<void> {
    const buf = new TextEncoder().encode(JSON.stringify(fields)).buffer;
    await this.backend.putData(this.ref(ino), buf);
  }

  async clear(ino: number): Promise<void> {
    await this.backend.deleteData(this.ref(ino));
  }

  async getField(
    ino: number,
    field: string,
  ): Promise<RecordValue | undefined> {
    const all = await this.load(ino);
    return all[field];
  }

  async setField(
    ino: number,
    field: string,
    value: RecordValue,
  ): Promise<void> {
    const all = await this.load(ino);
    all[field] = value;
    await this.save(ino, all);
  }

  async deleteField(ino: number, field: string): Promise<void> {
    const all = await this.load(ino);
    delete all[field];
    await this.save(ino, all);
  }

  async listFields(ino: number): Promise<string[]> {
    const all = await this.load(ino);
    return Object.keys(all);
  }

  async query(
    ino: number,
    query: RecordQuery,
    options?: RecordQueryOptions,
  ): Promise<RecordQueryResult[]> {
    const all = await this.load(ino);
    const results: RecordQueryResult[] = [];

    for (const [field, value] of Object.entries(all)) {
      const fieldValue = extractFieldValue(value, query.field);
      if (fieldValue !== undefined && matchesQuery(fieldValue, query)) {
        results.push({ field, value });
      }
    }

    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? results.length;
    return results.slice(offset, offset + limit);
  }
}
