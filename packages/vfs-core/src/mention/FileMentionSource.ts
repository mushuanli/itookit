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
  moduleName?: string; // [修改] 模块名现在是可选的
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
  private moduleName?: string;

  constructor({ vfsCore, moduleName }: FileSourceDependencies) {
    super();
    if (!vfsCore) {
      throw new Error("FileMentionSource requires a vfsCore instance.");
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
      // [修改] 调用 searchNodes，支持全局搜索（当 this.moduleName 为空时）
      const results: VNode[] = await this.vfsCore.searchNodes(
        {
          type: VNodeType.FILE,
          nameContains: query,
          limit: 20
        },
        this.moduleName
      );
      return results.map(node => ({
        id: node.nodeId,
        label: this.formatLabel(node),
        type: 'file',
        path: node.path,
        module: node.moduleId
      }));
    } catch (error) {
      console.error(`[FileMentionSource] Error getting suggestions:`, error);
      return [];
    }
  }

  /**
   * [新增] 格式化显示标签，处理同名文件冲突
   */
  private formatLabel(node: VNode): string {
    const parentPath = node.path.substring(0, node.path.lastIndexOf('/')) || '/';
    
    // 如果实例被限定在特定模块内，只需要显示相对路径来区分同模块下的文件
    if (this.moduleName) {
      // 如果是在根目录，不显示路径，否则显示父目录
      const context = parentPath === '/' ? '' : ` (${parentPath})`;
      return `📄 ${node.name}${context}`;
    } 
    
    // 如果是全局搜索，必须显示 [模块名] 和路径
    const context = parentPath === '/' ? '' : ` ${parentPath}`;
    return `📄 ${node.name} ([${node.moduleId}]${context})`;
  }

  public async getHoverPreview(targetURL: URL | string): Promise<HoverPreviewData | null> {
    if (!targetURL) {
        return null;
    }

    let urlObj: URL;
    try {
        urlObj = typeof targetURL === 'string' ? new URL(targetURL) : targetURL;
    } catch (e) {
        console.error('[FileMentionSource] URL Parse Error:', e);
        return null;
    }

    // 确保 pathname 存在
    if (!urlObj.pathname) {
        return null;
    }

    const fileId = urlObj.pathname.substring(1); 

    try {
      const vfs = this.vfsCore.getVFS();
      
      const [stat, content] = await Promise.all([
        vfs.stat(fileId),
        vfs.read(fileId)
      ]);
      
      const textContent = typeof content === 'string' 
        ? content 
        : new TextDecoder().decode(content as ArrayBuffer);
      
      const summary = textContent.substring(0, 150)
        .replace(/[\r\n]+/g, ' ') 
        .replace(/([#*`])/g, '') 
        + (textContent.length > 150 ? '...' : '');

      const size = stat.size < 1024 ? `${stat.size} B` : `${(stat.size / 1024).toFixed(1)} KB`;
      const moduleBadge = stat.metadata?.moduleId 
        ? `<span style="background:#eee; padding:2px 4px; border-radius:3px; font-size:0.8em; margin-right:5px;">${stat.metadata.moduleId}</span>` 
        : '';

      // 构建 HTML 字符串
      const htmlString = `
          <div class="vfs-hover-preview" style="font-size: 0.9em; line-height: 1.4;">
            <div style="margin-bottom: 6px; color: #666; font-size: 0.85em; display: flex; align-items: center;">
               ${moduleBadge}
               <span style="font-family: monospace;">${stat.path}</span>
            </div>
            <div style="margin-bottom: 8px; color: #333;">
              ${escapeHTML(summary)}
            </div>
            <div style="color: #999; font-size: 0.8em; border-top: 1px solid #eee; padding-top: 4px;">
              Size: ${size} · Updated: ${new Date(stat.modifiedAt).toLocaleDateString()}
            </div>
          </div>`;

      // [重要修复] 
      // 同时提供 content 和 contentHTML。
      // 这样无论前端组件是用 data.content 还是 data.contentHTML，都能读到数据。
      const result = {
        title: stat.name,
        content: htmlString,     // 兼容方案 A
        contentHTML: htmlString, // 兼容方案 B
        icon: '📄'
      };

      // 强制类型转换，因为我们添加了额外的 key，可能不完全符合 strict 接口定义，但在运行时这能救命
      return result as unknown as HoverPreviewData;

    } catch (error) {
      console.error('[FileMentionSource] Error inside getHoverPreview:', error);
      return null;
    }
  }
  
  /**
   * Provides raw data for headless processing by tools like MDxProcessor.
   * @param targetURL - The vfs://file/... URI.
   * @returns A promise resolving to the file's data or null.
   */
  public async getDataForProcess(targetURL: URL): Promise<any | null> {
    if (!targetURL || !targetURL.pathname) return null;
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
        module: node.moduleId,
        path: node.path,
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
