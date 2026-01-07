/**
 * @file: vfs-core/helper/BaseModuleService.ts
 * @description 基础应用服务，封装 VFS 挂载、JSON 读写和事件通知。
 */
import { VFSErrorCode } from '../core/types';
import { VFSCore } from '../VFSCore';
import { VFSModuleEngine } from './VFSModuleEngine';

export type ChangeListener = () => void;

export interface MountOptions {
  description?: string;
  isProtected?: boolean;
}

export abstract class BaseModuleService {
  protected vfs: VFSCore;
  public readonly moduleEngine: VFSModuleEngine;
  protected initialized = false;
  protected listeners = new Set<ChangeListener>();

  constructor(
    protected moduleName: string,
    protected mountOptions: MountOptions = {},
    vfs?: VFSCore
  ) {
    this.vfs = vfs ?? VFSCore.getInstance();
    this.moduleEngine = new VFSModuleEngine(moduleName, this.vfs);
  }

    /**
     * 模板方法：初始化流程
     */
  async init(): Promise<void> {
    if (this.initialized) return;
    
    await this.moduleEngine.init();
    await this.onLoad();
    
    this.initialized = true;
    this.notify();
  }

    /**
     * 子类需实现的加载逻辑
     */
  protected abstract onLoad(): Promise<void>;

  // ==================== JSON 辅助方法 ====================

  protected async readJson<T>(path: string): Promise<T | null> {
    try {
      const content = await this.vfs.read(this.moduleName, path);
      const str = typeof content === 'string' ? content : new TextDecoder().decode(content);
      return JSON.parse(str);
    } catch (e: any) {
      if (e.code !== VFSErrorCode.NOT_FOUND) {
        console.warn(`[${this.constructor.name}] Failed to read ${path}:`, e);
      }
      return null;
    }
  }

  protected async writeJson(path: string, data: unknown): Promise<void> {
    const content = JSON.stringify(data, null, 2);
    const existingId = await this.moduleEngine.resolvePath(path);

    if (existingId) {
      await this.moduleEngine.writeContent(existingId, content);
    } else {
      const lastSlash = path.lastIndexOf('/');
      const parentPath = lastSlash > 0 ? path.slice(0, lastSlash) : null;
      const fileName = path.slice(lastSlash + 1);
      await this.moduleEngine.createFile(fileName, parentPath, content);
    }
  }

  protected async deleteFile(path: string): Promise<void> {
    try {
      await this.vfs.delete(this.moduleName, path);
    } catch (e) {
      console.warn(`[${this.constructor.name}] Delete failed: ${path}`, e);
    }
  }

  // ==================== 变更通知 ====================

  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  protected notify(): void {
    this.listeners.forEach(l => l());
  }
}
