/**
 * @file vfs-ui/services/VFSService.ts
 * @desc Implements the service logic and provides a clean API for
 * all mutation operations required by the VFS-UI.
 */
import type { ISessionEngine, EngineNode } from '@itookit/common';

// --- 类型定义 ---

/**
 * Dependencies required by the VFSService constructor.
 * This follows the Dependency Injection pattern.
 */
export interface VFSServiceDependencies {
  engine: ISessionEngine;
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
 * Implements the service logic and provides a clean API for
 * all mutation operations required by the VFS-UI.
 */
// [修改] 不再继承 ISessionService
export class VFSService {
  private readonly engine: ISessionEngine;
  private readonly newFileContent: string;

  constructor({ engine, newFileContent = '' }: VFSServiceDependencies) {
    if (!engine) throw new Error("VFSService requires an ISessionEngine.");
    this.engine = engine;
    this.newFileContent = newFileContent;
  }

  public async createFile({ title = 'Untitled', parentId = null, content = this.newFileContent }: CreateFileOptions): Promise<EngineNode> {
    return this.engine.createFile(title, parentId, content);
  }

  public async createFiles({ parentId = null, files }: CreateMultipleFilesOptions): Promise<EngineNode[]> {
    if (!files || files.length === 0) return [];
    
    // [优化] 检查 Engine 是否支持原子批量创建
    if (typeof this.engine.createFiles === 'function') {
        return this.engine.createFiles(files, parentId);
    }

    // 回退逻辑：并发调用原子接口
    return Promise.all(
        files.map(file => this.engine.createFile(file.title, parentId, file.content))
    );
  }

  public async createDirectory({ title = 'New Directory', parentId = null }: CreateDirectoryOptions): Promise<EngineNode> {
    return this.engine.createDirectory(title, parentId);
  }

  public async renameItem(nodeId: string, newTitle: string): Promise<void> {
    await this.engine.rename(nodeId, newTitle);
  }

  public async deleteItems(nodeIds: string[]): Promise<void> {
    await this.engine.delete(nodeIds);
  }

  public async moveItems({ itemIds, targetId }: { itemIds: string[]; targetId: string | null }): Promise<void> {
    await this.engine.move(itemIds, targetId);
  }

  public async updateMultipleItemsTags({ itemIds, tags }: { itemIds: string[]; tags: string[] }): Promise<void> {
    // [优化] 检查 Engine 是否支持批量设置标签，现在这是类型安全的
    if (typeof this.engine.setTagsBatch === 'function') {
        const updates = itemIds.map(id => ({ id, tags }));
        await this.engine.setTagsBatch(updates);
    } else {
        // 回退逻辑
        await Promise.all(itemIds.map(id => this.engine.setTags(id, tags)));
    }
  }
  
  public async findItemById(itemId: string): Promise<EngineNode | null> {
      return this.engine.getNode(itemId);
  }

  public async updateItemMetadata(itemId: string, metadataUpdates: Record<string, any>): Promise<void> {
      await this.engine.updateMetadata(itemId, metadataUpdates);
  }

  public async getAllFolders(): Promise<EngineNode[]> {
      return this.engine.search({ type: 'directory' });
  }

  public async getAllFiles(): Promise<EngineNode[]> {
      return this.engine.search({ type: 'file' });
  }
}
