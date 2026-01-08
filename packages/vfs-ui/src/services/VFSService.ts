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
    console.log('VFSService option:',defaultExtension)
    if (!engine) throw new Error("VFSService requires an ISessionEngine.");
    this.engine = engine;
    this.newFileContent = newFileContent;
    // 确保扩展名以 . 开头
    this.defaultExtension = defaultExtension.startsWith('.') ? defaultExtension : `.${defaultExtension}`;
  }

  /**
   * 核心逻辑：智能追加扩展名
   */
    private ensureExtension(filename: string): string {
        return /\.[a-zA-Z0-9]{1,10}$/.test(filename)
            ? filename
            : `${filename}${this.defaultExtension}`;
    }

    async createFile({ title = 'Untitled', parentId = null, content = this.newFileContent }: CreateFileOptions): Promise<EngineNode> {
    // [优化] 自动补全扩展名
    const finalTitle = this.ensureExtension(title);
    console.log(`>>>>> createFile: ${title} - ${finalTitle}`)
    return this.engine.createFile(finalTitle, parentId, content);
  }

    async createFiles({ parentId = null, files }: CreateMultipleFilesOptions): Promise<EngineNode[]> {
        if (!files?.length) return [];

        const processedFiles = files.map(f => ({
            ...f,
            title: this.ensureExtension(f.title)
        }));

        return typeof this.engine.createFiles === 'function'
            ? this.engine.createFiles(processedFiles, parentId)
            : Promise.all(processedFiles.map(f => this.engine.createFile(f.title, parentId, f.content)));
    }

    async createDirectory({ title = 'New Directory', parentId = null }: CreateDirectoryOptions): Promise<EngineNode> {
        return this.engine.createDirectory(title, parentId);
    }

    async renameItem(nodeId: string, newTitle: string): Promise<void> {
        await this.engine.rename(nodeId, newTitle);
    }

    async deleteItems(nodeIds: string[]): Promise<void> {
        await this.engine.delete(nodeIds);
    }

    async moveItems({ itemIds, targetId }: { itemIds: string[]; targetId: string | null }): Promise<void> {
        await this.engine.move(itemIds, targetId);
    }

    async updateMultipleItemsTags({ itemIds, tags }: { itemIds: string[]; tags: string[] }): Promise<void> {
        if (typeof this.engine.setTagsBatch === 'function') {
            await this.engine.setTagsBatch(itemIds.map(id => ({ id, tags })));
        } else {
            await Promise.all(itemIds.map(id => this.engine.setTags(id, tags)));
        }
    }

    findItemById = (itemId: string) => this.engine.getNode(itemId);
    updateItemMetadata = (itemId: string, updates: Record<string, any>) => this.engine.updateMetadata(itemId, updates);
    getAllFolders = () => this.engine.search({ type: 'directory' });
    getAllFiles = () => this.engine.search({ type: 'file' });
}
