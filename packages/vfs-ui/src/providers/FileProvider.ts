/**
 * @file vfs-ui/src/providers/FileProvider.ts
 * @desc Implements IMentionProvider for files, fetching authoritative data from vfs-core.
 */

// [修正] 导入正确的类型并使用别名 'as'
import { IMentionProvider, escapeHTML, type Suggestion as AutocompleteSuggestion, type HoverPreviewData as HoverPreview } from '@itookit/common';
// [修正] 导入 VNodeType 枚举
import { VFSCore, VNode, NodeStat, VNodeType } from '@itookit/vfs-core';

/**
 * Dependencies required by the FileProvider.
 */
export interface FileProviderDependencies {
  vfsCore: VFSCore;
  moduleName: string;
}

/**
 * @class
 * @implements {IMentionProvider}
 * Provides @mention style autocompletion, hover previews, and data for files.
 * It communicates directly with vfs-core to ensure data is always accurate and up-to-date.
 */
export class FileProvider extends IMentionProvider {
  public readonly key = 'file';
  public readonly triggerChar = '@'; // Or could be another char like '[[', depending on config

  private vfsCore: VFSCore;
  private moduleName: string;

  constructor({ vfsCore, moduleName }: FileProviderDependencies) {
    super();
    if (!vfsCore || !moduleName) {
      throw new Error("FileProvider requires a vfsCore instance and a moduleName.");
    }
    this.vfsCore = vfsCore;
    this.moduleName = moduleName;
  }

  /**
   * Provides file suggestions based on a query string by searching within the specified module.
   * @param query - The search string entered by the user.
   * @returns A promise resolving to an array of file suggestions.
   */
  public async getSuggestions(query: string): Promise<AutocompleteSuggestion[]> {
    // Note: This relies on an efficient search method in vfs-core.
    // If vfsCore.searchNodes doesn't exist, a less efficient getTree + filter approach is needed.
    try {
      const results: VNode[] = await this.vfsCore.searchNodes(this.moduleName, {
        type: VNodeType.FILE,
        nameContains: query,
        limit: 10 // Good practice to limit suggestions
      });

      return results.map(node => ({
        id: node.nodeId,
        label: `📄 ${node.name}`,
        type: 'file',
      }));
    } catch (error) {
      console.error(`[FileProvider] Error getting suggestions for query "${query}":`, error);
      return [];
    }
  }

  /**
   * Provides a rich preview for a hovered file link.
   * @param targetURL - The vfs://file/... URI.
   * @returns A promise resolving to a hover preview object or null if not found.
   */
  public async getHoverPreview(targetURL: URL): Promise<HoverPreview | null> {
    const fileId = targetURL.pathname.substring(1);
    try {
      const vfs = this.vfsCore.getVFS();
      const stat = await vfs.stat(fileId);
      const content = await vfs.read(fileId) as string; // Assume text content
      
      const summary = content.substring(0, 150).replace(/\s+/g, ' ') + (content.length > 150 ? '...' : '');

      return {
        title: stat.name,
        contentHTML: `<p class="vfs-hover-summary">${escapeHTML(summary)}</p>`,
        icon: '📄'
      };
    } catch (error) {
      return null;
    }
  }
  
  /**
   * Provides raw data for headless processing by tools like MDxProcessor.
   * @param targetURL - The vfs://file/... URI.
   * @returns A promise resolving to the file's data or null.
   */
  public async getDataForProcess(targetURL: URL): Promise<any | null> {
    const fileId = targetURL.pathname.substring(1);
    try {
      const vfs = this.vfsCore.getVFS();
      const node = await vfs.storage.loadVNode(fileId); // loadVNode to get tags
      if (!node) return null;
      
      const content: string | ArrayBuffer = await vfs.read(fileId);
      
      return {
        id: node.nodeId,
        title: node.name,
        content: content,
        tags: node.tags,
        createdAt: new Date(node.createdAt),
        modifiedAt: new Date(node.modifiedAt),
        ...node.metadata,
      };
    } catch (error) {
      console.warn(`[FileProvider] Could not get data for process for ${fileId}:`, error);
      return null;
    }
  }

  /**
   * Handles clicks on a file link. This method should be implemented by the consuming application
   * (e.g., the editor) by subscribing to an event, rather than being handled by the provider itself.
   * The provider's role is data, not action.
   * @param targetURL - The vfs:// URI.
   */
  public async handleClick(targetURL: URL): Promise<void> {
    console.warn(`[FileProvider] handleClick is a UI concern and should be handled by the application, not the data provider. Target: ${targetURL.href}`);
    // In a real app, this would typically emit an event that the UI manager would listen for.
    // this.eventBus.emit('vfs-link-clicked', { type: 'file', id: targetURL.pathname.substring(1) });
  }
}
