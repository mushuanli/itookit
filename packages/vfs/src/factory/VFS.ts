// @file packages/vfs/src/VFS.ts

import {base64ToArrayBuffer,arrayBufferToBase64} from '@itookit/common';
import { VFSInstance } from './VFSFactory';
import {
  VFSKernel,
  VNodeData,
  VNodeType,
  VFSEventType,
  EventBus,
  pathResolver,
  IPlugin,
} from '../core';
import { ModulesPlugin, ModuleInfo } from '../modules';
import { TagsPlugin } from '../tags';
import { AssetsPlugin, AssetInfo } from '../assets';
import { MiddlewarePlugin, IMiddleware } from '../middleware';
import { MetadataMerger, defaultMerger } from './utils/MetadataMerger';

/**
 * 导入选项
 */
export interface ImportOptions {
  /** 冲突处理策略 */
  conflictStrategy?: 'skip' | 'overwrite' | 'rename-old' | 'merge';
  /** 是否合并元数据（用于 SRS 等场景） */
  mergeMetadata?: boolean;
  /** 自定义元数据合并函数 */
  metadataMerger?: MetadataMerger;
}

interface TreeData {
  name: string;
  type: VNodeType;
  content?: string;
  contentEncoding?: 'base64';
  metadata?: Record<string, unknown>;
  tags?: string[];
  children?: TreeData[];
  isAssetDirectory?: boolean;
}

interface BackupData {
  version: number;
  timestamp: number;
  modules: Array<{ module: ModuleInfo; tree: TreeData }>;
}

/**
 * VFS 高层门面类
 * 提供简化的 API 访问
 */
export class VFS {
  constructor(private instance: VFSInstance) {}

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
    return this.getPlugin('vfs-modules');
  }

  async mount(name: string, options?: { description?: string; isProtected?: boolean }): Promise<ModuleInfo> {
    const manager = this.modules?.getModuleManager();
    if (!manager) throw new Error('Modules plugin not available');
    return manager.mount(name, options);
  }

  async unmount(name: string): Promise<void> {
    const manager = this.modules?.getModuleManager();
    if (!manager) throw new Error('Modules plugin not available');
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
    return this.kernel.createNode({
      path: this.toSystemPath(module, path),
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
    return this.kernel.createNode({
      path: this.toSystemPath(module, path),
      type: VNodeType.DIRECTORY,
      metadata
    });
  }

  /**
   * 读取文件内容
   */
  async read(module: string, path: string): Promise<string | ArrayBuffer> {
    const nodeId = await this.resolvePath(module, path);
    if (!nodeId) throw new Error(`File not found: ${path}`);
    return this.kernel.read(nodeId);
  }

  /**
   * 写入文件内容
   */
  async write(module: string, path: string, content: string | ArrayBuffer): Promise<VNodeData> {
    const nodeId = await this.resolvePath(module, path);
    if (!nodeId) throw new Error(`File not found: ${path}`);
    return this.kernel.write(nodeId, content);
  }

  /**
   * 读取目录内容
   */
  async readdir(module: string, path: string): Promise<VNodeData[]> {
    const nodeId = await this.resolvePath(module, path);
    if (!nodeId) throw new Error(`Directory not found: ${path}`);
    return this.kernel.readdir(nodeId);
  }

  /**
   * 删除节点
   */
  async delete(module: string, path: string, recursive = false): Promise<string[]> {
    const nodeId = await this.resolvePath(module, path);
    if (!nodeId) return [];
    return this.kernel.unlink(nodeId, recursive);
  }

  /**
   * 移动节点
   */
  async move(module: string, oldPath: string, newPath: string): Promise<VNodeData> {
    const nodeId = await this.resolvePath(module, oldPath);
    if (!nodeId) throw new Error(`Node not found: ${oldPath}`);
    return this.kernel.move(nodeId, this.toSystemPath(module, newPath));
  }

  /**
   * 复制节点
   */
  async copy(module: string, sourcePath: string, targetPath: string): Promise<VNodeData> {
    const sourceId = await this.resolvePath(module, sourcePath);
    if (!sourceId) throw new Error(`Source not found: ${sourcePath}`);
    return this.kernel.copy(sourceId, this.toSystemPath(module, targetPath));
  }

  /**
   * 重命名节点
   */
  async rename(module: string, path: string, newName: string): Promise<VNodeData> {
    const nodeId = await this.resolvePath(module, path);
    if (!nodeId) throw new Error(`Node not found: ${path}`);
    
    const node = await this.kernel.getNode(nodeId);
    if (!node) throw new Error(`Node not found: ${path}`);
    
    const parentPath = pathResolver.dirname(node.path);
    return this.kernel.move(nodeId, pathResolver.join(parentPath, newName));
  }

  /**
   * 获取节点
   */
  async getNode(module: string, path: string): Promise<VNodeData | null> {
    return this.kernel.getNodeByPath(this.toSystemPath(module, path));
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
    if (!node) throw new Error(`Node not found: ${nodeId}`);
    
    node.metadata = { ...node.metadata, ...metadata };
    node.modifiedAt = Date.now();
    
    const tx = this.kernel.storage.beginTransaction(['vnodes'], 'readwrite');
    await tx.getCollection('vnodes').put(node);
    await tx.commit();
    
    return node;
  }

  // ==================== 标签操作 ====================

  private get tags(): TagsPlugin | undefined {
    return this.getPlugin('vfs-tags');
  }

  /**
   * 获取所有标签
   */
  async getAllTags(): Promise<Array<{ name: string; color?: string; refCount: number }>> {
    return this.tags?.getTagManager().getAllTags() ?? [];
  }

  /**
   * 为节点添加标签
   */
  async addTag(nodeId: string, tagName: string): Promise<void> {
    const manager = this.tags?.getTagManager();
    if (!manager) throw new Error('Tags plugin not available');
    await manager.addTagToNode(nodeId, tagName);
  }

  /**
   * 从节点移除标签
   */
  async removeTag(nodeId: string, tagName: string): Promise<void> {
    const manager = this.tags?.getTagManager();
    if (!manager) throw new Error('Tags plugin not available');
    await manager.removeTagFromNode(nodeId, tagName);
  }

  /**
   * 设置节点标签（覆盖模式）
   */
  async setTags(nodeId: string, tags: string[]): Promise<void> {
    const manager = this.tags?.getTagManager();
    if (!manager) throw new Error('Tags plugin not available');
    await manager.setNodeTags(nodeId, tags);
  }

  /**
   * 批量设置标签
   */
  async batchSetTags(updates: Array<{ nodeId: string; tags: string[] }>): Promise<void> {
    const manager = this.tags?.getTagManager();
    if (!manager) throw new Error('Tags plugin not available');
    await manager.batchSetTags(updates);
  }

  /**
   * 获取节点标签
   */
  async getNodeTags(nodeId: string): Promise<string[]> {
    return this.tags?.getTagManager().getNodeTags(nodeId) ?? [];
  }

  /**
   * 按标签查找节点
   */
  async findByTag(tagName: string): Promise<string[]> {
    return this.tags?.getTagManager().getNodeIdsByTag(tagName) ?? [];
  }

  /**
   * 更新标签定义
   */
  async updateTagDefinition(tagName: string, updates: { color?: string }): Promise<void> {
    const manager = this.tags?.getTagManager();
    if (!manager) throw new Error('Tags plugin not available');
    await manager.upsertTag(tagName, updates);
  }

  // ==================== 资产操作 ====================

  private get assets(): AssetsPlugin | undefined {
    return this.getPlugin('vfs-assets');
  }

  /**
   * 创建资产目录
   */
  async createAssetDirectory(ownerNodeId: string): Promise<VNodeData> {
    const manager = this.assets?.getAssetManager();
    if (!manager) throw new Error('Assets plugin not available');
    return manager.createAssetDirectory(ownerNodeId);
  }

  /**
   * 获取资产目录
   */
  async getAssetDirectory(ownerNodeId: string): Promise<VNodeData | null> {
    return this.assets?.getAssetManager().getAssetDirectory(ownerNodeId) ?? null;
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
    if (!manager) throw new Error('Assets plugin not available');
    return manager.createAsset(ownerNodeId, filename, content, metadata);
  }

  /**
   * 获取所有资产
   */
  async getAssets(ownerNodeId: string): Promise<AssetInfo[]> {
    return this.assets?.getAssetManager().getAssets(ownerNodeId) ?? [];
  }


  // ==================== 中间件操作 ====================

  private get middleware(): MiddlewarePlugin | undefined {
    return this.getPlugin('vfs-middleware');
  }

  /**
   * 注册中间件
   */
  registerMiddleware(middleware: IMiddleware): void {
    const plugin = this.middleware;
    if (!plugin) throw new Error('Middleware plugin not available');
    plugin.registerMiddleware(middleware);
  }

  /**
   * 注销中间件
   */
  async unregisterMiddleware(name: string): Promise<boolean> {
    return this.middleware?.unregisterMiddleware(name) ?? false;
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


  // ==================== 修改原有的导出方法以支持 Asset ====================

  /**
   * 导出模块数据（增强版，正确处理 asset 目录）
   */
  async exportModule(moduleName: string): Promise<Record<string, unknown>> {
    const info = this.getModule(moduleName);
    if (!info) throw new Error(`Module not found: ${moduleName}`);

    const rootNode = await this.kernel.getNode(info.rootNodeId);
    if (!rootNode) throw new Error('Root node not found');

    return {
      module: info,
      tree: await this.exportTree(rootNode),
      exportedAt: Date.now(),
      version: 2  // 标记导出格式版本
    };
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
   * 导入模块数据（支持增量导入和冲突处理）
   */
  async importModule(data: Record<string, unknown>, options: ImportOptions = {}): Promise<void> {
    const {
      conflictStrategy = 'rename-old',
      mergeMetadata = true,
      metadataMerger = defaultMerger
    } = options;

    const info = data.module as ModuleInfo;
    
    // ✅ 检查模块是否已存在
    const existingModule = this.getModule(info.name);
    
    if (!existingModule) {
      // 模块不存在，正常挂载
      await this.mount(info.name, {
        description: info.description,
        isProtected: info.isProtected
      });
    } else {
      console.log(`[VFS] Module ${info.name} already exists, performing incremental import`);
    }

    // 导入树结构（增量模式）
    await this.importTreeIncremental(
      info.name,
      '/',
      data.tree as TreeData,
      { conflictStrategy, mergeMetadata, metadataMerger }
    );
  }

  /**
   * 恢复系统备份（支持增量导入）
   */
  async restoreBackup(json: string, options: ImportOptions = {}): Promise<void> {
    const data = JSON.parse(json) as BackupData;

    for (const modData of data.modules) {
      try {
        await this.importModule(modData, options);
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

  // ==================== 私有方法 ====================

  private toSystemPath(module: string, userPath: string): string {
    const normalized = pathResolver.normalize(userPath);
    return normalized === '/' ? `/${module}` : `/${module}${normalized}`;
  }

  private async resolvePath(module: string, userPath: string): Promise<string | null> {
    return this.kernel.resolvePathToId(this.toSystemPath(module, userPath));
  }

  private async exportTree(node: VNodeData): Promise<TreeData> {
    const result: TreeData = {
      name: node.name,
      type: node.type,
      metadata: node.metadata
    };

    // 标记 asset 目录
    if (this.isAssetDirectory(node.name, node.path)) {
      result.isAssetDirectory = true;
    }

    if (node.type === VNodeType.FILE) {
      const content = await this.kernel.read(node.nodeId);
      if (content instanceof ArrayBuffer) {
        result.content = arrayBufferToBase64(content);
        result.contentEncoding = 'base64';
      } else {
        result.content = content;
      }
    } else {
      const children = await this.kernel.readdir(node.nodeId);
      result.children = await Promise.all(children.map(c => this.exportTree(c)));
    }

    // 导出标签
    if (this.tags) {
      result.tags = await this.tags.getTagManager().getNodeTags(node.nodeId);
    }

    return result;
  }


  /**
   * 增量导入树结构
   */
  private async importTreeIncremental(
    module: string,
    parentPath: string,
    data: TreeData,
    options: {
      conflictStrategy: 'skip' | 'overwrite' | 'rename-old' | 'merge';
      mergeMetadata: boolean;
      metadataMerger: MetadataMerger;
    }
  ): Promise<void> {
    // 跳过根节点
    if (data.name === '/' || (parentPath === '/' && data.name === module)) {
      for (const child of data.children ?? []) {
        await this.importTreeIncremental(module, '/', child, options);
      }
      return;
    }

    const nodePath = parentPath === '/' ? `/${data.name}` : `${parentPath}/${data.name}`;
    const existingNode = await this.getNode(module, nodePath);
    const isAsset = this.isAssetDirectory(data.name, nodePath);

    let node: VNodeData;

    if (existingNode) {
      node = await this.handleConflict(module, nodePath, existingNode, data, { ...options, isAsset });
    } else {
      // 节点不存在，正常创建
      node = await this.createNodeFromData(module, nodePath, data);
    }

    // 递归处理子节点（仅目录）
    if (data.type === VNodeType.DIRECTORY && data.children) {
      for (const child of data.children) {
        await this.importTreeIncremental(module, nodePath, child, options);
      }
    }

    // 恢复标签
    if (data.tags?.length && this.tags) {
      const existingTags = await this.tags.getTagManager().getNodeTags(node.nodeId);
      // 合并标签（取并集）
      const mergedTags = [...new Set([...existingTags, ...data.tags])];
      await this.tags.getTagManager().setNodeTags(node.nodeId, mergedTags);
    }
  }

  /**
   * 处理冲突
   */
  private async handleConflict(
    module: string,
    nodePath: string,
    existingNode: VNodeData,
    incomingData: TreeData,
    options: {
      conflictStrategy: 'skip' | 'overwrite' | 'rename-old' | 'merge';
      mergeMetadata: boolean;
      metadataMerger: MetadataMerger;
      isAsset: boolean;
    }
  ): Promise<VNodeData> {
    const { conflictStrategy, mergeMetadata, metadataMerger, isAsset } = options;

    // Asset 目录直接合并
    if (isAsset && existingNode.type === VNodeType.DIRECTORY) {
      return existingNode;
    }

    // 目录冲突：通常直接复用
    if (existingNode.type === VNodeType.DIRECTORY && incomingData.type === VNodeType.DIRECTORY) {
      // 可选：合并元数据
      if (mergeMetadata && incomingData.metadata) {
        const merged = metadataMerger.merge(existingNode.metadata, incomingData.metadata);
        await this.updateMetadata(existingNode.nodeId, merged);
        return { ...existingNode, metadata: merged };
      }
      return existingNode;
    }

    // 类型不匹配（目录 vs 文件）：这是严重冲突
    if (existingNode.type !== incomingData.type) {
      console.warn(`[VFS] Type mismatch at ${nodePath}: existing=${existingNode.type}, incoming=${incomingData.type}`);
      // 强制使用 rename-old 策略
      return this.handleRenameOld(module, nodePath, existingNode, incomingData);
    }

    // 文件冲突处理
    switch (conflictStrategy) {
      case 'skip':
        console.log(`[VFS] Skipping existing file: ${nodePath}`);
        return existingNode;

      case 'overwrite':
        return this.handleOverwrite(module, nodePath, existingNode, incomingData, mergeMetadata, metadataMerger);

      case 'rename-old':
        return this.handleRenameOld(module, nodePath, existingNode, incomingData);

      case 'merge':
        if (incomingData.metadata) {
          const merged = metadataMerger.merge(existingNode.metadata, incomingData.metadata);
          await this.updateMetadata(existingNode.nodeId, merged);
        }
        return (await this.getNode(module, nodePath))!;

      default:
        return this.handleRenameOld(module, nodePath, existingNode, incomingData);
    }
  }

  /**
   * 覆盖现有文件
   */
  private async handleOverwrite(
    module: string,
    nodePath: string,
    existingNode: VNodeData,
    incomingData: TreeData,
    mergeMetadata: boolean,
    metadataMerger: MetadataMerger
  ): Promise<VNodeData> {
    console.log(`[VFS] Overwriting existing file: ${nodePath}`);
    
    let content: string | ArrayBuffer = incomingData.content ?? '';
    if (incomingData.contentEncoding === 'base64' && typeof content === 'string') {
      content = base64ToArrayBuffer(content);
    }

    // 更新内容
    await this.write(module, nodePath, content);

    // 合并或替换元数据
    if (incomingData.metadata) {
      const finalMetadata = mergeMetadata
        ? metadataMerger.merge(existingNode.metadata, incomingData.metadata)
        : incomingData.metadata;
      await this.updateMetadata(existingNode.nodeId, finalMetadata);
    }

    return (await this.getNode(module, nodePath))!;
  }

  /**
   * 重命名旧文件，创建新文件
   */
  private async handleRenameOld(
    module: string,
    nodePath: string,
    existingNode: VNodeData,
    incomingData: TreeData
  ): Promise<VNodeData> {
    // 生成唯一的 -old 后缀
    const oldPath = await this.generateOldPath(module, nodePath);
    
    console.log(`[VFS] Renaming existing ${nodePath} to ${oldPath}`);
    
    // 重命名旧节点
    const parentPath = pathResolver.dirname(existingNode.path);
    const oldName = pathResolver.basename(oldPath);
    
    await this.kernel.move(existingNode.nodeId, pathResolver.join(parentPath, oldName));

    // 创建新节点
    return this.createNodeFromData(module, nodePath, incomingData);
  }

  /**
   * 从 TreeData 创建节点
   */
  private async createNodeFromData(module: string, nodePath: string, data: TreeData): Promise<VNodeData> {
    if (data.type === VNodeType.FILE) {
      let content: string | ArrayBuffer = data.content ?? '';
      if (data.contentEncoding === 'base64' && typeof content === 'string') {
        content = base64ToArrayBuffer(content);
      }
      return this.createFile(module, nodePath, content, data.metadata);
    }
    return this.createDirectory(module, nodePath, data.metadata);
  }

  /**
   * 生成唯一的 -old 路径
   */
  private async generateOldPath(module: string, originalPath: string): Promise<string> {
    const dir = pathResolver.dirname(originalPath);
    const basename = pathResolver.basename(originalPath);
    
    // 分离文件名和扩展名
    const lastDot = basename.lastIndexOf('.');
    const name = lastDot > 0 ? basename.substring(0, lastDot) : basename;
    const ext = lastDot > 0 ? basename.substring(lastDot) : '';

    let suffix = '-old';
    let counter = 1;
    let newPath = `${dir === '/' ? '' : dir}/${name}${suffix}${ext}`;

    // 确保路径唯一
    while (await this.getNode(module, newPath)) {
      suffix = `-old-${counter++}`;
      newPath = `${dir === '/' ? '' : dir}/${name}${suffix}${ext}`;
    }

    return newPath;
  }

  /**
   * 检测是否为 asset 目录
   */
  private isAssetDirectory(name: string, path: string): boolean {
    const patterns = [/\.assets$/, /_assets$/, /^assets$/, /\/assets\//];
    return patterns.some(p => p.test(name) || p.test(path));
  }
}

export default VFS;
