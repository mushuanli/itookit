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

const EXT_REGEX = /\.[a-zA-Z0-9]{1,10}$/;

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

  private ensureExtension = (filename: string): string =>
    EXT_REGEX.test(filename) ? filename : `${filename}${this.defaultExtension}`;

  createFile = async ({ title = 'Untitled', parentId = null, content = this.newFileContent }: CreateFileOptions = {}): Promise<EngineNode> =>
    this.engine.createFile(this.ensureExtension(title), parentId, content);

  createFiles = async ({ parentId = null, files }: CreateMultipleFilesOptions): Promise<EngineNode[]> => {
    if (!files?.length) return [];
    const processed = files.map(f => ({ ...f, title: this.ensureExtension(f.title) }));
    return this.engine.createFiles
      ? this.engine.createFiles(processed, parentId)
      : Promise.all(processed.map(f => this.engine.createFile(f.title, parentId, f.content)));
  };

  createDirectory = ({ title = 'New Directory', parentId = null } = {}): Promise<EngineNode> =>
    this.engine.createDirectory(title, parentId);

  renameItem = (nodeId: string, newTitle: string): Promise<void> =>
    this.engine.rename(nodeId, newTitle);

  deleteItems = (nodeIds: string[]): Promise<void> =>
    this.engine.delete(nodeIds);

  moveItems = ({ itemIds, targetId }: { itemIds: string[]; targetId: string | null }): Promise<void> =>
    this.engine.move(itemIds, targetId);

  updateMultipleItemsTags = async ({ itemIds, tags }: { itemIds: string[]; tags: string[] }): Promise<void> => {
    if (this.engine.setTagsBatch) {
      await this.engine.setTagsBatch(itemIds.map(id => ({ id, tags })));
    } else {
      await Promise.all(itemIds.map(id => this.engine.setTags(id, tags)));
    }
  };

  findItemById = (itemId: string) => this.engine.getNode(itemId);
  updateItemMetadata = (itemId: string, updates: Record<string, any>) => this.engine.updateMetadata(itemId, updates);
  getAllFolders = () => this.engine.search({ type: 'directory' });
  getAllFiles = () => this.engine.search({ type: 'file' });
}
