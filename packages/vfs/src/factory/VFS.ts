// @file packages/vfs/src/VFS.ts

import { VFSInstance } from './VFSFactory';
import {
  VFSKernel,
  VNodeData,
  VNodeType,
  VFSEventType,
  EventBus,
  pathResolver
} from '../core';
import { ModulesPlugin, ModuleInfo } from '../modules';
import { TagsPlugin } from '../tags';
import { AssetsPlugin } from '../assets';
import { MiddlewarePlugin, IMiddleware } from '../middleware';
import { AssetInfo } from '../assets';
import {IPlugin} from '../core';
/**
 * VFS 高层门面类
 * 提供简化的 API 访问
 */
export class VFS {
  private instance: VFSInstance;

  constructor(instance: VFSInstance) {
    this.instance = instance;
  }

  // ==================== 核心访问器 ====================

  get kernel(): VFSKernel {
    return this.instance.kernel;
  }

  get events(): EventBus {
    return this.instance.events;
  }
  // ✅ 新增：公开获取插件的方法
  getPlugin<T extends IPlugin>(id: string): T | undefined {
    return this.instance.getPlugin<T>(id);
  }

  // ==================== 模块操作 ====================

  private get modules(): ModulesPlugin | undefined {
    return this.instance.getPlugin('vfs-modules');
  }

  async mount(name: string, options?: { description?: string; isProtected?: boolean }): Promise<ModuleInfo> {
    const manager = this.modules?.getModuleManager();
    if (!manager) {
      throw new Error('Modules plugin not available');
    }
    return manager.mount(name, options);
  }

  async unmount(name: string): Promise<void> {
    const manager = this.modules?.getModuleManager();
    if (!manager) {
      throw new Error('Modules plugin not available');
    }
    return manager.unmount(name);
  }

  getModule(name: string): ModuleInfo | undefined {
    return this.modules?.getModuleManager().getModule(name);
  }

  getAllModules(): ModuleInfo[] {
    return this.modules?.getModuleManager().getAllModules() ?? [];
  }

  // ==================== 文件操作 ====================

  /**
   * 创建文件
   */
  async createFile(
    module: string,
    path: string,
    content: string | ArrayBuffer = '',
    metadata?: Record<string, unknown>
  ): Promise<VNodeData> {
    const systemPath = this.toSystemPath(module, path);
    return this.kernel.createNode({
      path: systemPath,
      type: VNodeType.FILE,
      content,
      metadata
    });
  }

  /**
   * 创建目录
   */
  async createDirectory(
    module: string,
    path: string,
    metadata?: Record<string, unknown>
  ): Promise<VNodeData> {
    const systemPath = this.toSystemPath(module, path);
    return this.kernel.createNode({
      path: systemPath,
      type: VNodeType.DIRECTORY,
      metadata
    });
  }

  /**
   * 读取文件内容
   */
  async read(module: string, path: string): Promise<string | ArrayBuffer> {
    const nodeId = await this.resolvePath(module, path);
    if (!nodeId) {
      throw new Error(`File not found: ${path}`);
    }
    return this.kernel.read(nodeId);
  }

  /**
   * 写入文件内容
   */
  async write(module: string, path: string, content: string | ArrayBuffer): Promise<VNodeData> {
    const nodeId = await this.resolvePath(module, path);
    if (!nodeId) {
      throw new Error(`File not found: ${path}`);
    }
    return this.kernel.write(nodeId, content);
  }

  /**
   * 读取目录内容
   */
  async readdir(module: string, path: string): Promise<VNodeData[]> {
    const nodeId = await this.resolvePath(module, path);
    if (!nodeId) {
      throw new Error(`Directory not found: ${path}`);
    }
    return this.kernel.readdir(nodeId);
  }

  /**
   * 删除节点
   */
  async delete(module: string, path: string, recursive = false): Promise<string[]> {
    const nodeId = await this.resolvePath(module, path);
    if (!nodeId) {
      return []; // 幂等操作
    }
    return this.kernel.unlink(nodeId, recursive);
  }

  /**
   * 移动节点
   */
  async move(module: string, oldPath: string, newPath: string): Promise<VNodeData> {
    const nodeId = await this.resolvePath(module, oldPath);
    if (!nodeId) {
      throw new Error(`Node not found: ${oldPath}`);
    }
    const newSystemPath = this.toSystemPath(module, newPath);
    return this.kernel.move(nodeId, newSystemPath);
  }

  /**
   * 复制节点
   */
  async copy(module: string, sourcePath: string, targetPath: string): Promise<VNodeData> {
    const sourceId = await this.resolvePath(module, sourcePath);
    if (!sourceId) {
      throw new Error(`Source not found: ${sourcePath}`);
    }
    const targetSystemPath = this.toSystemPath(module, targetPath);
    return this.kernel.copy(sourceId, targetSystemPath);
  }

  /**
   * 重命名节点
   */
  async rename(module: string, path: string, newName: string): Promise<VNodeData> {
    const nodeId = await this.resolvePath(module, path);
    if (!nodeId) {
      throw new Error(`Node not found: ${path}`);
    }
    const node = await this.kernel.getNode(nodeId);
    if (!node) {
      throw new Error(`Node not found: ${path}`);
    }
    const parentPath = pathResolver.dirname(node.path);
    const newPath = pathResolver.join(parentPath, newName);
    return this.kernel.move(nodeId, newPath);
  }

  /**
   * 获取节点
   */
  async getNode(module: string, path: string): Promise<VNodeData | null> {
    const systemPath = this.toSystemPath(module, path);
    return this.kernel.getNodeByPath(systemPath);
  }

  /**
   * 通过 ID 获取节点
   */
  async getNodeById(nodeId: string): Promise<VNodeData | null> {
    return this.kernel.getNode(nodeId);
  }

  /**
   * 更新节点元数据
   */
  async updateMetadata(nodeId: string, metadata: Record<string, unknown>): Promise<VNodeData> {
    const node = await this.kernel.getNode(nodeId);
    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }
    
    node.metadata = { ...node.metadata, ...metadata };
    node.modifiedAt = Date.now();
    
    const storage = (this.kernel as any).storage;
    const tx = storage.beginTransaction(['vnodes'], 'readwrite');
    await tx.getCollection('vnodes').put(node);
    await tx.commit();
    
    return node;
  }

  // ==================== 标签操作 ====================

  private get tags(): TagsPlugin | undefined {
    return this.instance.getPlugin('vfs-tags');
  }

  /**
   * 获取所有标签
   */
  async getAllTags(): Promise<Array<{ name: string; color?: string; refCount: number }>> {
    const manager = this.tags?.getTagManager();
    if (!manager) return [];
    return manager.getAllTags();
  }

  /**
   * 为节点添加标签
   */
  async addTag(nodeId: string, tagName: string): Promise<void> {
    const manager = this.tags?.getTagManager();
    if (!manager) {
      throw new Error('Tags plugin not available');
    }
    await manager.addTagToNode(nodeId, tagName);
  }

  /**
   * 从节点移除标签
   */
  async removeTag(nodeId: string, tagName: string): Promise<void> {
    const manager = this.tags?.getTagManager();
    if (!manager) {
      throw new Error('Tags plugin not available');
    }
    await manager.removeTagFromNode(nodeId, tagName);
  }

  /**
   * 设置节点标签（覆盖模式）
   */
  async setTags(nodeId: string, tags: string[]): Promise<void> {
    const manager = this.tags?.getTagManager();
    if (!manager) {
      throw new Error('Tags plugin not available');
    }
    await manager.setNodeTags(nodeId, tags);
  }

  /**
   * 批量设置标签
   */
  async batchSetTags(updates: Array<{ nodeId: string; tags: string[] }>): Promise<void> {
    const manager = this.tags?.getTagManager();
    if (!manager) {
      throw new Error('Tags plugin not available');
    }
    await manager.batchSetTags(updates);
  }

  /**
   * 获取节点标签
   */
  async getNodeTags(nodeId: string): Promise<string[]> {
    const manager = this.tags?.getTagManager();
    if (!manager) return [];
    return manager.getNodeTags(nodeId);
  }

  /**
   * 按标签查找节点
   */
  async findByTag(tagName: string): Promise<string[]> {
    const manager = this.tags?.getTagManager();
    if (!manager) return [];
    return manager.getNodeIdsByTag(tagName);
  }

  /**
   * 更新标签定义
   */
  async updateTagDefinition(tagName: string, updates: { color?: string }): Promise<void> {
    const manager = this.tags?.getTagManager();
    if (!manager) {
      throw new Error('Tags plugin not available');
    }
    await manager.upsertTag(tagName, updates);
  }

  // ==================== 资产操作 ====================

  private get assets(): AssetsPlugin | undefined {
    return this.instance.getPlugin('vfs-assets');
  }

  /**
   * 创建资产目录
   */
  async createAssetDirectory(ownerNodeId: string): Promise<VNodeData> {
    const manager = this.assets?.getAssetManager();
    if (!manager) {
      throw new Error('Assets plugin not available');
    }
    return manager.createAssetDirectory(ownerNodeId);
  }

  /**
   * 获取资产目录
   */
  async getAssetDirectory(ownerNodeId: string): Promise<VNodeData | null> {
    const manager = this.assets?.getAssetManager();
    if (!manager) return null;
    return manager.getAssetDirectory(ownerNodeId);
  }

  /**
   * 创建资产文件
   */
  async createAsset(
    ownerNodeId: string,
    filename: string,
    content: string | ArrayBuffer,
    metadata?: Record<string, unknown>
  ): Promise<VNodeData> {
    const manager = this.assets?.getAssetManager();
    if (!manager) {
      throw new Error('Assets plugin not available');
    }
    return manager.createAsset(ownerNodeId, filename, content, metadata);
  }

  /**
   * 获取所有资产
   */
  async getAssets(ownerNodeId: string): Promise<AssetInfo[]> {
    const manager = this.assets?.getAssetManager();
    if (!manager) return [];
    return manager.getAssets(ownerNodeId);
  }


  // ==================== 中间件操作 ====================

  private get middleware(): MiddlewarePlugin | undefined {
    return this.instance.getPlugin('vfs-middleware');
  }

  /**
   * 注册中间件
   */
  registerMiddleware(middleware: IMiddleware): void {
    const plugin = this.middleware;
    if (!plugin) {
      throw new Error('Middleware plugin not available');
    }
    plugin.registerMiddleware(middleware);
  }

  /**
   * 注销中间件
   */
  async unregisterMiddleware(name: string): Promise<boolean> {
    const plugin = this.middleware;
    if (!plugin) return false;
    return plugin.unregisterMiddleware(name);
  }

  // ==================== 事件订阅 ====================

  /**
   * 订阅事件
   */
  on(type: VFSEventType, handler: (event: any) => void): () => void {
    return this.events.on(type, handler);
  }

  /**
   * 订阅所有事件
   */
  onAny(handler: (type: VFSEventType, event: any) => void): () => void {
    return this.events.onAny(handler);
  }

  // ==================== 备份与恢复 ====================

  /**
   * 导出模块数据
   */
  async exportModule(moduleName: string): Promise<Record<string, unknown>> {
    const info = this.getModule(moduleName);
    if (!info) {
      throw new Error(`Module not found: ${moduleName}`);
    }

    const rootNode = await this.kernel.getNode(info.rootNodeId);
    if (!rootNode) {
      throw new Error('Root node not found');
    }

    return {
      module: info,
      tree: await this.exportTree(rootNode)
    };
  }

  /**
   * 导入模块数据
   */
  async importModule(data: Record<string, unknown>): Promise<void> {
    const info = data.module as ModuleInfo;
    
    // 挂载模块
    await this.mount(info.name, {
      description: info.description,
      isProtected: info.isProtected
    });

    // 导入树结构
    await this.importTree(info.name, '/', data.tree as TreeData);
  }

  /**
   * 创建系统备份
   */
  async createBackup(): Promise<string> {
    const backup: BackupData = {
      version: 1,
      timestamp: Date.now(),
      modules: []
    };

    for (const mod of this.getAllModules()) {
      if (mod.isProtected && mod.name === '__vfs_meta__') continue;

      try {
        const exported = await this.exportModule(mod.name);
        backup.modules.push(exported as any);
      } catch (e) {
        console.warn(`Skipping module ${mod.name}:`, e);
      }
    }

    return JSON.stringify(backup, null, 2);
  }

  /**
   * 恢复系统备份
   */
  async restoreBackup(json: string): Promise<void> {
    const data = JSON.parse(json) as BackupData;

    for (const modData of data.modules) {
      try {
        await this.importModule(modData);
      } catch (e) {
        console.error(`Failed to restore ${modData?.module?.name}:`, e);
      }
    }
  }

  // ==================== 生命周期 ====================

  /**
   * 关闭 VFS
   */
  async shutdown(): Promise<void> {
    await this.instance.shutdown();
  }

  // ==================== 私有辅助方法 ====================

  private toSystemPath(module: string, userPath: string): string {
    const normalized = pathResolver.normalize(userPath);
    return normalized === '/' ? `/${module}` : `/${module}${normalized}`;
  }

  private async resolvePath(module: string, userPath: string): Promise<string | null> {
    const systemPath = this.toSystemPath(module, userPath);
    return this.kernel.resolvePathToId(systemPath);
  }

  private async exportTree(node: VNodeData): Promise<TreeData> {
    const result: TreeData = {
      name: node.name,
      type: node.type,
      metadata: node.metadata
    };

    if (node.type === VNodeType.FILE) {
      const content = await this.kernel.read(node.nodeId);
      if (content instanceof ArrayBuffer) {
        result.content = this.arrayBufferToBase64(content);
        result.contentEncoding = 'base64';
      } else {
        result.content = content;
      }
    } else {
      const children = await this.kernel.readdir(node.nodeId);
      result.children = await Promise.all(
        children.map(child => this.exportTree(child))
      );
    }

    // 导出标签
    if (this.tags) {
      result.tags = await this.tags.getTagManager().getNodeTags(node.nodeId);
    }

    return result;
  }

  private async importTree(module: string, parentPath: string, data: TreeData): Promise<void> {
    // 跳过根节点
    if (data.name === '/' || (parentPath === '/' && data.name === module)) {
      for (const child of data.children ?? []) {
        await this.importTree(module, '/', child);
      }
      return;
    }

    const nodePath = parentPath === '/' 
      ? `/${data.name}` 
      : `${parentPath}/${data.name}`;

    let node: VNodeData;

    if (data.type === VNodeType.FILE) {
      let content: string | ArrayBuffer = data.content ?? '';
      
      // 处理 base64 编码的二进制内容
      if (data.contentEncoding === 'base64' && typeof content === 'string') {
        content = this.base64ToArrayBuffer(content);
      }

      node = await this.createFile(module, nodePath, content, data.metadata);
    } else {
      node = await this.createDirectory(module, nodePath, data.metadata);

      for (const child of data.children ?? []) {
        await this.importTree(module, nodePath, child);
      }
    }

    // 恢复标签
    if (data.tags?.length && this.tags) {
      await this.tags.getTagManager().setNodeTags(node.nodeId, data.tags);
    }
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
}

// ==================== 辅助类型 ====================

interface TreeData {
  name: string;
  type: VNodeType;
  content?: string;
  contentEncoding?: 'base64';
  metadata?: Record<string, unknown>;
  tags?: string[];
  children?: TreeData[];
}

interface BackupData {
  version: number;
  timestamp: number;
  modules: Array<{ module: ModuleInfo; tree: TreeData }>;
}

export default VFS;
