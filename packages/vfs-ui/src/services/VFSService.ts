/**
 * @file vfs-ui/services/VFSService.ts
 * @desc Data mutation service implementing IDataOperationPort.
 */
import type { ISessionEngine, EngineNode } from '@itookit/common';
import type { IDataOperationPort } from '../contracts/ports';

export interface VFSServiceDependencies {
  engine: ISessionEngine;
  newFileContent?: string;
  defaultExtension?: string;
}

export interface CreateFileOptions {
  title?: string;
  parentId?: string | null;
  content?: string | ArrayBuffer;
}

export interface CreateMultipleFilesOptions {
  parentId?: string | null;
  files: { title: string; content: string | ArrayBuffer }[];
}

const EXT_REGEX = /\.[a-zA-Z0-9]{1,10}$/;

export class VFSService implements IDataOperationPort {
  private readonly engine: ISessionEngine;
  private readonly newFileContent: string;
  private readonly defaultExtension: string;

  constructor({
    engine,
    newFileContent = '',
    defaultExtension = '.md',
  }: VFSServiceDependencies) {
    if (!engine) throw new Error('VFSService requires an ISessionEngine.');
    this.engine = engine;
    this.newFileContent = newFileContent;
    this.defaultExtension = defaultExtension.startsWith('.')
      ? defaultExtension
      : `.${defaultExtension}`;
  }

  private ensureExtension = (filename: string): string =>
    EXT_REGEX.test(filename) ? filename : `${filename}${this.defaultExtension}`;

  createFile = async ({
    title = 'Untitled',
    parentId = null,
    content = this.newFileContent,
  }: CreateFileOptions = {}): Promise<EngineNode> =>
    this.engine.createFile(this.ensureExtension(title), parentId, content);

  createFiles = async ({
    parentId = null,
    files,
  }: CreateMultipleFilesOptions): Promise<EngineNode[]> => {
    if (!files?.length) return [];
    const processed = files.map(f => ({
      ...f,
      title: this.ensureExtension(f.title),
    }));
    return this.engine.createFiles
      ? this.engine.createFiles(processed, parentId)
      : Promise.all(
          processed.map(f => this.engine.createFile(f.title, parentId, f.content))
        );
  };

  createDirectory = ({
    title = 'New Directory',
    parentId = null,
  }: { title?: string; parentId?: string | null } = {}): Promise<EngineNode> =>
    this.engine.createDirectory(title, parentId);

  renameItem = (nodeId: string, newTitle: string): Promise<void> =>
    this.engine.rename(nodeId, newTitle);

  deleteItems = (nodeIds: string[]): Promise<void> => this.engine.delete(nodeIds);

  moveItems = ({
    itemIds,
    targetId,
  }: {
    itemIds: string[];
    targetId: string | null;
  }): Promise<void> => this.engine.move(itemIds, targetId);

  updateMultipleItemsTags = async ({
    itemIds,
    tags,
  }: {
    itemIds: string[];
    tags: string[];
  }): Promise<void> => {
    if (this.engine.setTagsBatch) {
      await this.engine.setTagsBatch(itemIds.map(id => ({ id, tags })));
    } else {
      await Promise.all(itemIds.map(id => this.engine.setTags(id, tags)));
    }
  };

  findItemById = (itemId: string) => this.engine.getNode(itemId);
  updateItemMetadata = (itemId: string, updates: Record<string, any>) =>
    this.engine.updateMetadata(itemId, updates);
  getAllFolders = () => this.engine.search({ type: 'directory' });
  getAllFiles = () => this.engine.search({ type: 'file' });
}
