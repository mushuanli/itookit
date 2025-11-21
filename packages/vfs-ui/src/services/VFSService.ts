/**
 * @file vfs-ui/services/VFSService.ts
 * @desc Acts as a stateless bridge between UI commands and vfs-core's high-level API.
 * This service is responsible for all "write" operations (Create, Update, Delete).
 */

// --- 外部接口与类型 ---
import { ISessionService } from '@itookit/common';
import { VFSCore, VNode, VNodeType, NodeStat, VFS } from '@itookit/vfs-core';

// --- 类型定义 ---

/**
 * Dependencies required by the VFSService constructor.
 * This follows the Dependency Injection pattern.
 */
export interface VFSServiceDependencies {
  vfsCore: VFSCore;
  moduleName: string;
  newFileContent?: string;
}

/**
 * Options for creating a new file (session).
 */
export interface CreateFileOptions {
  title?: string;
  parentId?: string | null;
  content?: string | ArrayBuffer;
}

/**
 * ✨ [新增] Options for creating multiple files.
 */
export interface CreateMultipleFilesOptions {
    parentId?: string | null;
    files: { title: string; content: string | ArrayBuffer }[];
}


/**
 * Options for creating a new directory.
 */
export interface CreateDirectoryOptions {
  title?: string;
  parentId?: string | null;
}

/**
 * Implements the ISessionService interface and provides a clean API for
 * all mutation operations required by the VFS-UI.
 */
export class VFSService extends ISessionService<VNode> {
  private readonly vfsCore: VFSCore;
  private readonly moduleName: string;
  private readonly newFileContent: string;
  private readonly vfs: VFS;

  constructor({ vfsCore, moduleName, newFileContent = '' }: VFSServiceDependencies) {
    super();

    // [核心变更] No longer depends on the UI store.
    if (!vfsCore || !moduleName) {
      throw new Error("VFSService requires a vfsCore instance and a moduleName.");
    }
    this.vfsCore = vfsCore;
    this.moduleName = moduleName;
    this.newFileContent = newFileContent;
    this.vfs = this.vfsCore.getVFS(); 
  }

  // --- ISessionService Implementation & Public API ---

  // [修正] 实现 createSession 并返回创建的节点
  public async createSession(options: CreateFileOptions): Promise<VNode> {
    return this.createFile(options);
  }

  // [修正] 修改 createFile 返回 VNode
  public async createFile({ title = 'Untitled', parentId = null, content = this.newFileContent }: CreateFileOptions): Promise<VNode> {
    const path = await this._buildPath(parentId, title);
    return this.vfsCore.createFile(this.moduleName, path, content);
  }

  /**
   * ✨ [新增] Creates multiple files within a specified parent directory.
   * This enables features like multi-file import.
   * @param options - The options for creating multiple files.
   * @returns A promise that resolves to an array of the created VNodes.
   */
  public async createFiles({ parentId = null, files }: CreateMultipleFilesOptions): Promise<VNode[]> {
    if (!files || files.length === 0) {
        return [];
    }

    const parentPath = parentId ? await this._getParentRelativePath(parentId) : '';

    return Promise.all(
        files.map(file => {
            const relativePath = this.vfs.pathResolver.join(parentPath, file.title);
            return this.vfsCore.createFile(this.moduleName, relativePath, file.content);
        })
    );
  }


  public async createDirectory({ title = 'New Directory', parentId = null }: CreateDirectoryOptions): Promise<VNode> {
    const path = await this._buildPath(parentId, title);
    return this.vfsCore.createDirectory(this.moduleName, path);
  }

  public async renameItem(nodeId: string, newTitle: string): Promise<void> {
    // [修正] To rename, we construct the new path based on the parent's path.
    const nodeStat = await this.vfs.stat(nodeId);
    // [修正] 从完整路径中解析出父路径
    const parentPath = this.vfs.pathResolver.dirname(nodeStat.path);
    // [修正] 将模块前缀从路径中剥离，因为 `vfs.move` 需要的是模块内的相对路径
    const modulePathPrefix = `/${this.moduleName}`;
    let relativeParentPath = parentPath;
    if (relativeParentPath.startsWith(modulePathPrefix)) {
        relativeParentPath = relativeParentPath.substring(modulePathPrefix.length);
    }
    const newRelativePath = this.vfs.pathResolver.join(relativeParentPath, newTitle);
    
    await this.vfs.move(nodeId, newRelativePath);
  }

  public async deleteItems(nodeIds: string[]): Promise<void> {
    // Use Promise.all for concurrent deletion
    await Promise.all(
      nodeIds.map(id => this.vfs.unlink(id, { recursive: true }))
    );
  }

  public async moveItems({ itemIds, targetId }: { itemIds: string[]; targetId: string | null }): Promise<void> {
    // [修正] 允许 targetId 为 null (根目录)
    const targetPath = targetId ? (await this.vfs.stat(targetId)).path : `/${this.moduleName}`;

    await Promise.all(
        itemIds.map(async (id) => {
            const sourceStat = await this.vfs.stat(id);
            const newPath = this.vfs.pathResolver.join(targetPath, sourceStat.name);
            
            // [修正] 转换为模块内相对路径
            const modulePathPrefix = `/${this.moduleName}`;
            let relativeNewPath = newPath;
            if(relativeNewPath.startsWith(modulePathPrefix)) {
                relativeNewPath = relativeNewPath.substring(modulePathPrefix.length);
            }

            await this.vfs.move(id, relativeNewPath);
        })
    );
  }

  public async updateMultipleItemsTags({ itemIds, tags }: { itemIds: string[]; tags: string[] }): Promise<void> {
    // [修正] This implements the "setTags" logic using available vfs-core APIs.
    const newTagsSet = new Set(tags);
    
    for (const id of itemIds) {
        const currentTags = await this.vfs.getTags(id);
        const currentTagsSet = new Set(currentTags);

        // Add tags that are in the new set but not the current set
        for (const tagToAdd of newTagsSet) {
            if (!currentTagsSet.has(tagToAdd)) {
                await this.vfs.addTag(id, tagToAdd);
            }
        }

        // Remove tags that are in the current set but not the new set
        for (const tagToRemove of currentTagsSet) {
            if (!newTagsSet.has(tagToRemove)) {
                await this.vfs.removeTag(id, tagToRemove);
            }
        }
    }
  }
  
  // [新增] 实现 ISessionService 缺失的方法
  public async findItemById(itemId: string): Promise<VNode | null> {
      try {
          return await this.vfs.storage.loadVNode(itemId);
      } catch (e) {
          return null;
      }
  }

  public async updateItemMetadata(itemId: string, metadataUpdates: Record<string, any>): Promise<void> {
      const node = await this.findItemById(itemId);
      if (!node) throw new Error(`Node ${itemId} not found`);
      const newMetadata = { ...node.metadata, ...metadataUpdates };
      await this.vfsCore.updateNodeMetadata(itemId, newMetadata);
  }

  public async getAllFolders(): Promise<VNode[]> {
      // [修正] searchNodes 参数顺序已变更: (query, moduleName)
      return this.vfsCore.searchNodes({ type: VNodeType.DIRECTORY }, this.moduleName);
  }

  public async getAllFiles(): Promise<VNode[]> {
      // [修正] searchNodes 参数顺序已变更: (query, moduleName)
      return this.vfsCore.searchNodes({ type: VNodeType.FILE }, this.moduleName);
  }

  // --- Private Helper Methods ---

  /**
   * ✨ [重构] Safely constructs the relative path for a new node.
   * This now uses the VFS path resolver for robust path joining, fixing the in-directory creation bug.
   */
  private async _buildPath(parentId: string | null, title: string): Promise<string> {
    const parentPath = parentId ? await this._getParentRelativePath(parentId) : '';
    return this.vfs.pathResolver.join(parentPath, title);
  }

  /**
   * ✨ [新增辅助方法] Gets the parent's path relative to the module root.
   */
  private async _getParentRelativePath(parentId: string): Promise<string> {
    try {
        const parentStat: NodeStat = await this.vfs.stat(parentId);
        if (parentStat.type !== VNodeType.DIRECTORY) {
            throw new Error(`Node with ID ${parentId} is not a directory.`);
        }

        const modulePathPrefix = `/${this.moduleName}`;
        let parentModulePath = parentStat.path;

        if (parentModulePath.startsWith(modulePathPrefix)) {
            parentModulePath = parentModulePath.substring(modulePathPrefix.length);
        }
        
        // Remove leading slash if it exists, as path.join handles it.
        return parentModulePath.startsWith('/') ? parentModulePath.substring(1) : parentModulePath;
    } catch (error) {
        console.warn(`[VFSService] Could not find parent with ID "${parentId}". Defaulting to root.`, error);
        return '';
    }
  }
}
