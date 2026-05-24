/**
 * @file vfs-ui/services/VFSService.ts
 * @desc Data mutation service implementing IDataOperationPort.
 */
import type { IModuleFS, FSNode } from '@itookit/common';
import { formatDefaultFileTitle } from '@itookit/common';
import type { IDataOperationPort } from '../contracts/ports';

export interface VFSServiceDependencies {
  engine: IModuleFS;
  newFileContent?: string;
  defaultExtension?: string;
}

export interface CreateFileOptions {
  title?: string;
  parentPath?: string | null;
  content?: string | ArrayBuffer;
}

export interface CreateMultipleFilesOptions {
  parentPath?: string | null;
  files: { title: string; content: string | ArrayBuffer }[];
}

const EXT_REGEX = /\.[a-zA-Z0-9]{1,10}$/;

export class VFSService implements IDataOperationPort {
  private readonly engine: IModuleFS;
  private readonly newFileContent: string;
  private readonly defaultExtension: string;

  constructor({
    engine,
    newFileContent = '',
    defaultExtension = '.md',
  }: VFSServiceDependencies) {
    if (!engine) throw new Error('VFSService requires an IModuleFS.');
    this.engine = engine;
    this.newFileContent = newFileContent;
    this.defaultExtension = defaultExtension.startsWith('.')
      ? defaultExtension
      : `.${defaultExtension}`;
  }

  private ensureExtension = (filename: string): string =>
    EXT_REGEX.test(filename) ? filename : `${filename}${this.defaultExtension}`;

  createFile = async ({
    title,
    parentPath = null,
    content = this.newFileContent,
  }: CreateFileOptions = {}): Promise<FSNode> => {
    const rawName = title || formatDefaultFileTitle();

    if (!rawName.includes('/')) {
      return this.engine.driver.createFile({
        name: this.ensureExtension(rawName),
        parentPath,
        content,
      });
    }

    // Parse "dir/subdir/filename" — build absolute virtual path and enable recursive mkdir.
    const lastSlash = rawName.lastIndexOf('/');
    const dirPart = rawName.slice(0, lastSlash);
    const fileName = rawName.slice(lastSlash + 1) || formatDefaultFileTitle();

    const base = parentPath ?? '/';
    const resolvedParentPath: string | null = dirPart ? `${base}/${dirPart}` : (parentPath ?? null);

    return this.engine.driver.createFile({
      name: this.ensureExtension(fileName),
      parentPath: resolvedParentPath,
      content,
      recursive: true,
    });
  };

  createFiles = async ({
    parentPath = null,
    files,
  }: CreateMultipleFilesOptions): Promise<FSNode[]> => {
    if (!files?.length) return [];
    return Promise.all(
      files.map(f =>
        this.engine.driver.createFile({
          name: this.ensureExtension(f.title),
          parentPath,
          content: f.content,
        })
      )
    );
  };

  createDirectory = async ({
    title = 'New Directory',
    parentPath = null,
  }: { title?: string; parentPath?: string | null } = {}): Promise<FSNode> => {
    if (!title.includes('/')) {
      return this.engine.driver.createDirectory({ name: title, parentPath });
    }

    // Parse "parent/subdir" path — build absolute virtual path and enable recursive mkdir.
    const lastSlash = title.lastIndexOf('/');
    const dirPart = title.slice(0, lastSlash);
    const dirName = title.slice(lastSlash + 1) || 'New Directory';

    const base = parentPath ?? '/';
    const resolvedParentPath: string | null = dirPart ? `${base}/${dirPart}` : (parentPath ?? null);

    return this.engine.driver.createDirectory({
      name: dirName,
      parentPath: resolvedParentPath,
      recursive: true,
    });
  };

  renameItem = (nodeId: string, newTitle: string): Promise<void> =>
    this.engine.driver.rename(nodeId, newTitle);

  deleteItems = (nodeIds: string[]): Promise<void> =>
    this.engine.driver.delete(nodeIds);

  moveItems = ({
    itemIds,
    targetId,
  }: {
    itemIds: string[];
    targetId: string | null;
  }): Promise<void> => this.engine.driver.move(itemIds, targetId);

  updateMultipleItemsTags = async ({
    itemIds,
    tags,
  }: {
    itemIds: string[];
    tags: string[];
  }): Promise<void> => {
    await Promise.all(itemIds.map(id => this.engine.meta.tags.setTags(id, tags)));
  };

  findItemById = (itemId: string) => this.engine.driver.getNode(itemId);
  updateItemMetadata = (itemId: string, updates: Record<string, any>) =>
    this.engine.driver.updateMetadata(itemId, updates);
  getAllFolders = () => this.engine.driver.search({ type: 'directory' });
  getAllFiles = () => this.engine.driver.search({ type: 'file' });
}
