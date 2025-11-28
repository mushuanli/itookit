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
  /** [新增] 创建文件时的默认扩展名，默认为 .md */
  defaultExtension?: string;
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
  private readonly defaultExtension: string;

  constructor({ engine, newFileContent = '', defaultExtension = '.md' }: VFSServiceDependencies) {
    if (!engine) throw new Error("VFSService requires an ISessionEngine.");
    this.engine = engine;
    this.newFileContent = newFileContent;
    // 确保扩展名以 . 开头
    this.defaultExtension = defaultExtension.startsWith('.') ? defaultExtension : `.${defaultExtension}`;
  }

  /**
   * 辅助方法：确保文件名有扩展名
   */
  private ensureExtension(filename: string): string {
    // 简单判断：如果文件名包含 . 且不在开头，认为已有扩展名
    // 更严谨的逻辑可以根据需要调整
    if (filename.lastIndexOf('.') > 0) {
        return filename;
    }
    return `${filename}${this.defaultExtension}`;
  }

  public async createFile({ title = 'Untitled', parentId = null, content = this.newFileContent }: CreateFileOptions): Promise<EngineNode> {
    // [优化] 自动补全扩展名
    const finalTitle = this.ensureExtension(title);
    return this.engine.createFile(finalTitle, parentId, content);
  }

  public async createFiles({ parentId = null, files }: CreateMultipleFilesOptions): Promise<EngineNode[]> {
    if (!files || files.length === 0) return [];

    // [优化] 批量处理时也补全扩展名
    const processedFiles = files.map(f => ({
        ...f,
        title: this.ensureExtension(f.title)
    }));
    
    if (typeof this.engine.createFiles === 'function') {
        return this.engine.createFiles(processedFiles, parentId);
    }

    return Promise.all(
        processedFiles.map(file => this.engine.createFile(file.title, parentId, file.content))
    );
  }

  public async createDirectory({ title = 'New Directory', parentId = null }: CreateDirectoryOptions): Promise<EngineNode> {
    return this.engine.createDirectory(title, parentId);
  }

  public async renameItem(nodeId: string, newTitle: string): Promise<void> {
    // 注意：renameItem 这里不自动补全扩展名，因为 Manager 层会处理好带扩展名的全名
    // 或者我们假定传入的 newTitle 已经是完整的
    await this.engine.rename(nodeId, newTitle);
  }

  public async deleteItems(nodeIds: string[]): Promise<void> {
    await this.engine.delete(nodeIds);
  }

  public async moveItems({ itemIds, targetId }: { itemIds: string[]; targetId: string | null }): Promise<void> {
    await this.engine.move(itemIds, targetId);
  }

  public async updateMultipleItemsTags({ itemIds, tags }: { itemIds: string[]; tags: string[] }): Promise<void> {
    if (typeof this.engine.setTagsBatch === 'function') {
        const updates = itemIds.map(id => ({ id, tags }));
        await this.engine.setTagsBatch(updates);
    } else {
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
