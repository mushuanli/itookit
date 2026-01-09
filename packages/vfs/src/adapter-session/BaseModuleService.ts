// @file packages/vfs-adapter-session/src/BaseModuleService.ts

import { VFS } from '../factory/VFS';
import { VFSModuleEngine } from './VFSModuleEngine';

/**
 * 变更监听器类型
 */
export type ChangeListener = () => void;

/**
 * 模块服务配置
 */
export interface ModuleServiceOptions {
  description?: string;
  isProtected?: boolean;
}

/**
 * 基础模块服务
 * 提供模块初始化、JSON 读写、变更通知等通用功能
 */
export abstract class BaseModuleService {
  protected vfs: VFS;
  public readonly engine: VFSModuleEngine;
  protected initialized = false;
  protected listeners = new Set<ChangeListener>();

  constructor(
    protected moduleName: string,
    protected options: ModuleServiceOptions = {},
    vfs: VFS
  ) {
    this.vfs = vfs;
    this.engine = new VFSModuleEngine(moduleName, vfs);
  }

  /**
   * 初始化服务
   */
  async init(): Promise<void> {
    if (this.initialized) return;

    await this.engine.init();
    await this.onLoad();

    this.initialized = true;
    this.notify();
  }

  /**
   * 子类实现的加载逻辑
   */
  protected abstract onLoad(): Promise<void>;

  /**
   * 是否已初始化
   */
  get isInitialized(): boolean {
    return this.initialized;
  }

  // ==================== JSON 辅助方法 ====================

  /**
   * 读取 JSON 文件
   */
  protected async readJson<T>(path: string): Promise<T | null> {
    try {
      const content = await this.vfs.read(this.moduleName, path);
      const str = typeof content === 'string'
        ? content
        : new TextDecoder().decode(content as ArrayBuffer);
      return JSON.parse(str);
    } catch (e: any) {
      // 检查是否是 "not found" 类型的错误
      const isNotFound = 
        e.message?.toLowerCase().includes('not found') ||
        e.code === 'NOT_FOUND';
      
      if (!isNotFound) {
        console.warn(`[${this.constructor.name}] Failed to read ${path}:`, e);
      }
      return null;
    }
  }

  /**
   * 写入 JSON 文件
   */
  protected async writeJson(path: string, data: unknown): Promise<void> {
    const content = JSON.stringify(data, null, 2);
    const existingId = await this.engine.resolvePath(path);

    if (existingId) {
      await this.engine.writeContent(existingId, content);
    } else {
      const lastSlash = path.lastIndexOf('/');
      const parentPath = lastSlash > 0 ? path.slice(0, lastSlash) : null;
      const fileName = path.slice(lastSlash + 1);
      
      // 确保父目录存在
      if (parentPath && parentPath !== '/') {
        await this.ensureDirectory(parentPath);
      }
      
      await this.engine.createFile(fileName, parentPath, content);
    }
  }

  /**
   * 确保目录存在
   */
  protected async ensureDirectory(path: string): Promise<void> {
    const existingId = await this.engine.resolvePath(path);
    if (existingId) return;

    const parts = path.split('/').filter(Boolean);
    let currentPath = '';

    for (const part of parts) {
      currentPath += '/' + part;
      const nodeId = await this.engine.resolvePath(currentPath);
      
      if (!nodeId) {
        const parentPath = currentPath.substring(0, currentPath.lastIndexOf('/')) || null;
        await this.engine.createDirectory(part, parentPath);
      }
    }
  }

  /**
   * 删除文件
   */
  protected async deleteFile(path: string): Promise<void> {
    try {
      const nodeId = await this.engine.resolvePath(path);
      if (nodeId) {
        await this.engine.delete([nodeId]);
      }
    } catch (e) {
      console.warn(`[${this.constructor.name}] Delete failed: ${path}`, e);
    }
  }

  /**
   * 检查文件是否存在
   */
  protected async fileExists(path: string): Promise<boolean> {
    return this.engine.pathExists(path);
  }

  // ==================== 变更通知 ====================

  /**
   * 订阅变更
   */
  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 通知所有监听器
   */
  protected notify(): void {
    this.listeners.forEach(l => {
      try {
        l();
      } catch (e) {
        console.error('Change listener error:', e);
      }
    });
  }

  /**
   * 清理资源
   */
  async dispose(): Promise<void> {
    this.listeners.clear();
    this.initialized = false;
  }
}
