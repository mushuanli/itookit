import { fileTypeIcon } from '../utils/local';
/**
 * @file vfs-ui/services/FileTypeRegistry.ts
 * @desc Centralized file type registry implementing IFileTypePort.
 */
import type { IFileTypePort } from '../contracts/ports';
import { getExtension } from '../utils/helpers';

export interface FileTypeDefinition {
  extensions: string[];
  mimeTypes?: string[];
  icon?: string;
  contentParser?: ContentParser;
  duplicateTransformer?: DuplicateTransformer;
}

export type ContentParser = (content: string, fileExtension: string) => any;
export type DuplicateTransformer = (content: string) => string | Promise<string>;
export type IconResolver = (filename: string, isDirectory: boolean) => string;
export type ContentParserResolver = (filename: string) => ContentParser | undefined;

export class FileTypeRegistry implements IFileTypePort {
  constructor(private readonly defaultIcon: IconResolver = fileTypeIcon) {}

  private extensionMap = new Map<string, FileTypeDefinition>();

  register(def: FileTypeDefinition): void {
    def.extensions.forEach(ext => {
      this.extensionMap.set(ext.toLowerCase(), { ...def });
    });
  }

  getIcon(filename: string, isDirectory = false): string {
    return (!isDirectory && this.extensionMap.get(getExtension(filename))?.icon) || this.defaultIcon(filename, isDirectory);
  }

  resolveContentParser(filename: string): ContentParser | undefined {
    return this.extensionMap.get(getExtension(filename))?.contentParser;
  }

  getDuplicateTransformer(extension: string): DuplicateTransformer | undefined {
    return this.extensionMap.get(extension.toLowerCase())?.duplicateTransformer;
  }
}
