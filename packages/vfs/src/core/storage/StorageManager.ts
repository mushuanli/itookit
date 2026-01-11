// @file vfs/core/storage/StorageManager.ts

import { IStorageAdapter, CollectionSchema } from './interfaces/IStorageAdapter';

/**
 * 存储适配器工厂类型
 */
export type StorageAdapterFactory = (
  config: Record<string, unknown>,
  schemas: CollectionSchema[]
) => IStorageAdapter;

// 核心 Schema 定义
const CORE_SCHEMAS: CollectionSchema[] = [
  {
    name: 'vnodes',
    keyPath: 'nodeId',
    indexes: [
      { name: 'path', keyPath: 'path', unique: true },
      { name: 'parentId', keyPath: 'parentId' },
      { name: 'type', keyPath: 'type' },
      { name: 'name', keyPath: 'name' }
    ]
  },
  {
    name: 'contents',
    keyPath: 'contentRef',
    indexes: [{ name: 'nodeId', keyPath: 'nodeId' }]
  }
];

/**
 * 存储管理器
 * 负责适配器注册和创建
 */
export class StorageManager {
  private static factories = new Map<string, StorageAdapterFactory>();
  private static schemas: CollectionSchema[] = [...CORE_SCHEMAS];

  /**
   * 注册存储适配器工厂
   */
  static registerAdapter(type: string, factory: StorageAdapterFactory): void {
    this.factories.set(type, factory);
  }

  /**
   * 注销存储适配器
   */
  static unregisterAdapter(type: string): boolean {
    return this.factories.delete(type);
  }

  /**
   * 创建适配器实例
   */
  static createAdapter(
    type: string,
    config: Record<string, unknown>,
    extraSchemas: CollectionSchema[] = []
  ): IStorageAdapter {
    const factory = this.factories.get(type);
    if (!factory) {
      throw new Error(`Unknown storage adapter type: ${type}`);
    }
    
    const allSchemas = [...this.schemas, ...extraSchemas];
    console.log(`[StorageManager] Creating ${type} adapter with ${allSchemas.length} schemas`);
    
    return factory(config, allSchemas);
  }

  /**
   * 获取所有已注册的适配器类型
   */
  static getRegisteredTypes(): string[] {
    return Array.from(this.factories.keys());
  }

  /**
   * 注册默认 Schema
   */
  static registerDefaultSchema(schema: CollectionSchema): void {
    const index = this.schemas.findIndex(s => s.name === schema.name);
    if (index >= 0) {
      this.schemas[index] = schema;
    } else {
      this.schemas.push(schema);
    }
  }

  /**
   * 获取默认 Schema
   */
  static getDefaultSchemas(): CollectionSchema[] {
    return [...this.schemas];
  }

  /**
   * ✅ 新增：重置所有 Schema（用于测试）
   */
  static resetSchemas(): void {
    this.schemas = [...CORE_SCHEMAS];
  }
}
