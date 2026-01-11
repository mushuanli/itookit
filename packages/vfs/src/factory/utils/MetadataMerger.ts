// @file packages/vfs/src/utils/MetadataMerger.ts

/**
 * 元数据合并器配置
 */
export interface MergerConfig {
  srsFields?: string[];
  timestampFields?: string[];
}

const DEFAULT_SRS_FIELDS = [
  'interval', 'repetition', 'efactor', 'ease', 'due', 'dueDate',
  'lastReview', 'nextReview', 'reviewCount', 'lapses',
  'stability', 'difficulty', 'state', 'scheduledDays'
];

const DEFAULT_TIMESTAMP_PATTERNS = ['At', 'Time', 'Date'];

/**
 * 元数据合并器
 */
export class MetadataMerger {
  private srsFields: Set<string>;
  private timestampPatterns: string[];

  constructor(config: MergerConfig = {}) {
    this.srsFields = new Set(config.srsFields ?? DEFAULT_SRS_FIELDS);
    this.timestampPatterns = config.timestampFields ?? DEFAULT_TIMESTAMP_PATTERNS;
  }

  /**
   * 合并两个元数据对象
   */
  merge(
    existing: Record<string, unknown>,
    incoming: Record<string, unknown>
  ): Record<string, unknown> {
    const merged = { ...existing };

    for (const [key, incomingValue] of Object.entries(incoming)) {
      const existingValue = existing[key];
      merged[key] = this.mergeValue(key, existingValue, incomingValue);
    }

    return merged;
  }

  private mergeValue(key: string, existing: unknown, incoming: unknown): unknown {
    // SRS 字段
    if (this.isSRSField(key)) {
      return this.mergeSRSValue(key, existing, incoming);
    }

    // 时间戳字段
    if (this.isTimestampField(key)) {
      return this.mergeTimestamp(existing, incoming);
    }

    // 数组：合并去重
    if (Array.isArray(existing) && Array.isArray(incoming)) {
      return [...new Set([...existing, ...incoming])];
    }

    // 对象：递归合并
    if (this.isPlainObject(existing) && this.isPlainObject(incoming)) {
      return this.merge(
        existing as Record<string, unknown>,
        incoming as Record<string, unknown>
      );
    }

    // 默认：incoming 优先
    return incoming;
  }

  private isSRSField(key: string): boolean {
    return this.srsFields.has(key) || 
           key.startsWith('srs') || 
           key.startsWith('fsrs');
  }

  private isTimestampField(key: string): boolean {
    const timestampKeywords = [
      'createdAt', 'modifiedAt', 'updatedAt', 
      'lastAccess', 'lastModified', 'timestamp'
    ];
    
    if (timestampKeywords.includes(key)) return true;
    
    return this.timestampPatterns.some(pattern => 
      key.endsWith(pattern)
    );
  }

  private mergeSRSValue(key: string, existing: unknown, incoming: unknown): unknown {
    // 复习次数：取较大值
    if (['reviewCount', 'repetition', 'lapses'].includes(key)) {
      const existingNum = typeof existing === 'number' ? existing : 0;
      const incomingNum = typeof incoming === 'number' ? incoming : 0;
      return Math.max(existingNum, incomingNum);
    }

    // 时间相关：取较新的
    if (['due', 'dueDate', 'nextReview', 'lastReview'].includes(key)) {
      const existingTime = this.toTimestamp(existing);
      const incomingTime = this.toTimestamp(incoming);
      return existingTime > incomingTime ? existing : incoming;
    }

    return incoming;
  }

  private mergeTimestamp(existing: unknown, incoming: unknown): unknown {
    const existingTime = this.toTimestamp(existing);
    const incomingTime = this.toTimestamp(incoming);
    return Math.max(existingTime, incomingTime);
  }

  private toTimestamp(value: unknown): number {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return isNaN(parsed) ? 0 : parsed;
    }
    if (value instanceof Date) return value.getTime();
    return 0;
  }

  private isPlainObject(value: unknown): boolean {
    return typeof value === 'object' && 
           value !== null && 
           !Array.isArray(value);
  }
}

// 默认实例
export const defaultMerger = new MetadataMerger();
