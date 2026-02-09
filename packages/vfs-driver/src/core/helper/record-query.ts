// core/helper/record-query.ts
import type { RecordValue, RecordQuery } from '../../interface/types';

/**
 * 从 RecordValue 中提取嵌套字段值
 * 支持点号路径如 "a.b.c"
 * 
 * 被 FallbackRecordOps、MemoryBackend、IndexedDBBackend 共用
 */
export function extractFieldValue(
  value: RecordValue,
  targetField: string,
): RecordValue | undefined {
  if (targetField.includes('.')) {
    const parts = targetField.split('.');
    let current: unknown = value;
    for (const part of parts) {
      if (
        current === null ||
        current === undefined ||
        typeof current !== 'object' ||
        Array.isArray(current)
      ) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }
    return current as RecordValue;
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return (value as Record<string, RecordValue>)[targetField];
  }

  return value;
}

/**
 * 检查字段值是否匹配查询条件
 */
export function matchesQuery(
  fieldValue: RecordValue,
  query: RecordQuery,
): boolean {
  const { operator, value: queryValue } = query;

  switch (operator) {
    case '=':
      return JSON.stringify(fieldValue) === JSON.stringify(queryValue);
    case '!=':
      return JSON.stringify(fieldValue) !== JSON.stringify(queryValue);
    case '<':
      return (
        typeof fieldValue === 'number' &&
        typeof queryValue === 'number' &&
        fieldValue < queryValue
      );
    case '>':
      return (
        typeof fieldValue === 'number' &&
        typeof queryValue === 'number' &&
        fieldValue > queryValue
      );
    case '<=':
      return (
        typeof fieldValue === 'number' &&
        typeof queryValue === 'number' &&
        fieldValue <= queryValue
      );
    case '>=':
      return (
        typeof fieldValue === 'number' &&
        typeof queryValue === 'number' &&
        fieldValue >= queryValue
      );
    case 'in':
      return (
        Array.isArray(queryValue) &&
        queryValue.some(
          (v) => JSON.stringify(v) === JSON.stringify(fieldValue),
        )
      );
    case 'contains':
      return (
        Array.isArray(fieldValue) &&
        fieldValue.some(
          (v) => JSON.stringify(v) === JSON.stringify(queryValue),
        )
      );
    default:
      return false;
  }
}
