/**
 * @file vfs-ui/services/FileTypeRegistry.ts
 * @desc Centralized file type registry implementing IFileTypePort.
 */
import type { EditorFactory } from '@itookit/common';
import type { IFileTypePort } from '../contracts/ports';
import type { VFSNodeUI } from '../contracts/types';
import { getExtension } from '../utils/helpers';

export interface FileTypeDefinition {
  extensions: string[];
  mimeTypes?: string[];
  icon?: string;
  editorFactory?: EditorFactory;
  contentParser?: ContentParser;
  duplicateTransformer?: DuplicateTransformer;
}

export type ContentParser = (content: string, fileExtension: string) => any;
export type DuplicateTransformer = (content: string) => string | Promise<string>;
export type CustomEditorResolver = (node: VFSNodeUI) => EditorFactory | null | undefined;
export type IconResolver = (filename: string, isDirectory: boolean) => string;
export type ContentParserResolver = (filename: string) => ContentParser | undefined;

const DEFAULT_ICON_MAP: Record<string, string> = {
  '.md': '📝', '.txt': '📄', '.js': '☕', '.ts': '📘',
  '.json': '📦', '.html': '🌐', '.css': '🎨',
  '.png': '🖼️', '.jpg': '🖼️', '.jpeg': '🖼️', '.gif': '🖼️', '.svg': '📐',
  folder: '📁', default: '📄',
};

export class FileTypeRegistry implements IFileTypePort {
  private extensionMap = new Map<string, FileTypeDefinition>();
  private defaultFactory: EditorFactory;
  private customResolver?: CustomEditorResolver;

  constructor(defaultEditorFactory: EditorFactory, customResolver?: CustomEditorResolver) {
    this.defaultFactory = defaultEditorFactory;
    this.customResolver = customResolver;
  }

  register(def: FileTypeDefinition): void {
    def.extensions.forEach(ext => {
      this.extensionMap.set(ext.toLowerCase(), { ...def });
    });
  }

  getIcon(filename: string, isDirectory = false): string {
    if (isDirectory) return DEFAULT_ICON_MAP['folder'];
    const ext = getExtension(filename);
    return (
      this.extensionMap.get(ext)?.icon ||
      DEFAULT_ICON_MAP[ext] ||
      DEFAULT_ICON_MAP['default']
    );
  }

  resolveEditorFactory(node: VFSNodeUI): EditorFactory {
    if (this.customResolver) {
      const factory = this.customResolver(node);
      if (factory) return factory;
    }
    const ext = (
      (node.metadata.custom?._extension as string) ||
      getExtension(node.metadata.path || node.metadata.title || '')
    ).toLowerCase();
    return this.extensionMap.get(ext)?.editorFactory || this.defaultFactory;
  }

  resolveContentParser(filename: string): ContentParser | undefined {
    return this.extensionMap.get(getExtension(filename))?.contentParser;
  }

  getDuplicateTransformer(extension: string): DuplicateTransformer | undefined {
    return this.extensionMap.get(extension.toLowerCase())?.duplicateTransformer;
  }
}
