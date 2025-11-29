/**
 * @file vfs/core/ModuleRegistry.ts
 * 模块注册表
 */

import { VFSError, VFSErrorCode } from './types.js';

/**
 * 模块信息
 */
export interface ModuleInfo {
  name: string;
  rootNodeId: string;
  description?: string;
  createdAt: number;
  metadata?: Record<string, any>;
  
  /**
   * [新增] 模块保护标识
   * true: 该模块仅允许被自己访问 (mention/search)，即使别人指定了 globalSearch 也不可见。
   * false/undefined: 公开，允许被其他模块搜索到。
   */
  isProtected?: boolean; 
}

/**
 * 模块注册表
 * 管理 VFS 中的所有模块（命名空间）
 */
export class ModuleRegistry {
  private modules: Map<string, ModuleInfo> = new Map();

  /**
   * 注册模块
   */
  register(info: ModuleInfo): void {
    if (this.modules.has(info.name)) {
      throw new VFSError(
        VFSErrorCode.ALREADY_EXISTS,
        `Module '${info.name}' already registered`
      );
    }
    this.modules.set(info.name, info);
  }

  /**
   * 注销模块
   */
  unregister(name: string): boolean {
    return this.modules.delete(name);
  }

  /**
   * 获取模块信息
   */
  get(name: string): ModuleInfo | undefined {
    return this.modules.get(name);
  }

  /**
   * 检查模块是否存在
   */
  has(name: string): boolean {
    return this.modules.has(name);
  }

  /**
   * 获取所有模块名称
   */
  getModuleNames(): string[] {
    return Array.from(this.modules.keys());
  }

  /**
   * 获取所有模块信息
   */
  getAll(): ModuleInfo[] {
    return Array.from(this.modules.values());
  }

  /**
   * 更新模块信息
   */
  update(name: string, updates: Partial<Omit<ModuleInfo, 'name'>>): void {
    const existing = this.modules.get(name);
    if (!existing) {
      throw new VFSError(
        VFSErrorCode.NOT_FOUND,
        `Module '${name}' not found`
      );
    }
    
    this.modules.set(name, {
      ...existing,
      ...updates
    });
  }

  /**
   * 清空所有模块
   */
  clear(): void {
    this.modules.clear();
  }

  /**
   * 序列化模块信息（用于持久化）
   */
  toJSON(): Record<string, ModuleInfo> {
    const result: Record<string, ModuleInfo> = {};
    for (const [name, info] of this.modules.entries()) {
      result[name] = { ...info };
    }
    return result;
  }

  /**
   * 从 JSON 恢复模块信息
   */
  fromJSON(data: Record<string, ModuleInfo>): void {
    this.modules.clear();
    for (const [name, info] of Object.entries(data)) {
      this.modules.set(name, info);
    }
  }
}
