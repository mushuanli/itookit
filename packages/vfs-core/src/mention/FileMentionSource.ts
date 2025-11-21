/**
 * @file vfs-core/mention/FileMentionSource.ts
 * @desc Implements IMentionSource for files, fetching authoritative data from vfs-core.
 */

import { 
  IMentionSource, 
  escapeHTML, 
  type Suggestion, 
  type HoverPreviewData 
} from '@itookit/common';

// [修正] 从 VFS Core 导入必要的类型和枚举
import { VFSCore } from '../VFSCore';
import { VNode, VNodeType } from '../store/types.js';

/**
 * Dependencies required by the FileMentionSource.
 */
export interface FileSourceDependencies {
  vfsCore: VFSCore;
  moduleName: string;
}

/**
 * @class
 * @implements {IMentionSource}
 * Provides @mention style autocompletion, hover previews, and data for files.
 * It communicates directly with vfs-core to ensure data is always accurate and up-to-date.
 */
export class FileMentionSource extends IMentionSource {
  public readonly key = 'file';
  public readonly triggerChar = '@'; // Or could be another char like '[[', depending on config

  private vfsCore: VFSCore;
  private moduleName: string;

  constructor({ vfsCore, moduleName }: FileSourceDependencies) {
    super();
    if (!vfsCore || !moduleName) {
      throw new Error("FileMentionSource requires a vfsCore instance and a moduleName.");
    }
    this.vfsCore = vfsCore;
    this.moduleName = moduleName;
  }

  /**
   * Provides file suggestions based on a query string by searching within the specified module.
   * @param query - The search string entered by the user.
   * @returns A promise resolving to an array of file suggestions.
   */
  public async getSuggestions(query: string): Promise<Suggestion[]> {
    try {
      // 使用 vfsCore 的搜索 API
      const results: VNode[] = await this.vfsCore.searchNodes(this.moduleName, {
        type: VNodeType.FILE,
        nameContains: query,
        limit: 10
      });

      return results.map(node => ({
        id: node.nodeId,
        label: `📄 ${node.name}`,
        type: 'file',
        // 可以携带额外数据供 UI 使用
        path: node.path 
      }));
    } catch (error) {
      console.error(`[FileMentionSource] Error getting suggestions:`, error);
      return [];
    }
  }

  /**
   * Provides a rich preview for a hovered file link.
   * @param targetURL - The vfs://file/... URI.
   * @returns A promise resolving to a hover preview object or null if not found.
   */
  public async getHoverPreview(targetURL: URL): Promise<HoverPreviewData | null> {
    // URL 格式假设: vfs://file/<nodeId>
    const fileId = targetURL.pathname.substring(1); 
    // 或者如果 URL 格式是 vfs://<module>/<path>，解析逻辑需要相应调整
    
    try {
      const vfs = this.vfsCore.getVFS();
      
      // 并行获取状态和内容
      const [stat, content] = await Promise.all([
        vfs.stat(fileId),
        vfs.read(fileId)
      ]);

      const textContent = typeof content === 'string' 
        ? content 
        : new TextDecoder().decode(content as ArrayBuffer);
      
      const summary = textContent.substring(0, 150).replace(/\s+/g, ' ') + (textContent.length > 150 ? '...' : '');

      return {
        title: stat.name,
        contentHTML: `<div class="vfs-hover-preview">
          <div class="vfs-meta">Size: ${stat.size} bytes</div>
          <p class="vfs-summary">${escapeHTML(summary)}</p>
        </div>`,
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
      const node = await vfs.storage.loadVNode(fileId);
      if (!node) return null;
      
      const content = await vfs.read(fileId);
      
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
      console.warn(`[FileMentionSource] Process data fetch failed for ${fileId}:`, error);
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
    console.warn(`[FileMentionSource] handleClick is a UI concern and should be handled by the application, not the data provider. Target: ${targetURL.href}`);
    // In a real app, this would typically emit an event that the UI manager would listen for.
    // this.eventBus.emit('vfs-link-clicked', { type: 'file', id: targetURL.pathname.substring(1) });
  }
}
