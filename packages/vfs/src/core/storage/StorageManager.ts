// @file vfs/core/storage/StorageManager.ts

import { IStorageAdapter, CollectionSchema } from './interfaces/IStorageAdapter';

/**
 * 存储适配器工厂类型
 */
export type StorageAdapterFactory = (
  config: Record<string, unknown>,
  schemas: CollectionSchema[]
) => IStorageAdapter;

/**
 * 存储管理器
 * 负责适配器注册和创建
 */
export class StorageManager {
  private static factories = new Map<string, StorageAdapterFactory>();
  private static defaultSchemas: CollectionSchema[] = [];

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
    
    // ✅ 合并所有 Schema
    const schemas = [...this.defaultSchemas, ...extraSchemas];
    
    console.log(`[StorageManager] Creating ${type} adapter with ${schemas.length} schemas:`, 
      schemas.map(s => s.name).join(', '));
    
    return factory(config, schemas);
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
    const existing = this.defaultSchemas.findIndex(s => s.name === schema.name);
    if (existing >= 0) {
      // 更新已存在的 Schema
      this.defaultSchemas[existing] = schema;
    } else {
      this.defaultSchemas.push(schema);
      console.log(`[StorageManager] Registered schema: ${schema.name}`);
    }
  }

  /**
   * 获取默认 Schema
   */
  static getDefaultSchemas(): CollectionSchema[] {
    return [...this.defaultSchemas];
  }

  /**
   * ✅ 新增：重置所有 Schema（用于测试）
   */
  static resetSchemas(): void {
    this.defaultSchemas = [];
  }
}

// 注册核心 Schema
StorageManager.registerDefaultSchema({
  name: 'vnodes',
  keyPath: 'nodeId',
  indexes: [
    { name: 'path', keyPath: 'path', unique: true },
    { name: 'parentId', keyPath: 'parentId' },
    { name: 'type', keyPath: 'type' },
    { name: 'name', keyPath: 'name' }
  ]
});

StorageManager.registerDefaultSchema({
  name: 'contents',
  keyPath: 'contentRef',
  indexes: [
    { name: 'nodeId', keyPath: 'nodeId' }
  ]
});
