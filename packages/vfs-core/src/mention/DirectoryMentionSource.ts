/**
 * @file vfs-core/mention/DirectoryMentionSource.ts
 * @desc Implements IMentionSource for directories, fetching data from vfs-core.
 */

import { 
  IMentionSource, 
  type Suggestion, 
  type HoverPreviewData 
} from '@itookit/common';
import { VFSCore } from '../VFSCore';
import { VNode, VNodeType } from '../store/types.js';

/**
 * Dependencies required by the DirectoryMentionSource.
 */
export interface DirectorySourceDependencies {
  vfsCore: VFSCore;
  moduleName?: string;
}

/**
 * @class
 * @implements {IMentionSource}
 * Provides autocompletion and hover previews for directories (folders).
 */
export class DirectoryMentionSource extends IMentionSource {
  public readonly key = 'dir';
  public readonly triggerChar = '@';

  private vfsCore: VFSCore;
  private moduleName?: string;

  constructor({ vfsCore, moduleName }: DirectorySourceDependencies) {
    super();
    if (!vfsCore) {
      throw new Error("DirectoryMentionSource requires a vfsCore instance.");
    }
    this.vfsCore = vfsCore;
    this.moduleName = moduleName;
  }

  /**
   * Provides directory suggestions based on a query.
   * @param query - The search string.
   * @returns A promise resolving to an array of directory suggestions.
   */
  public async getSuggestions(query: string): Promise<Suggestion[]> {
    try {
      const results: VNode[] = await this.vfsCore.searchNodes(
        {
          type: VNodeType.DIRECTORY,
          nameContains: query,
          limit: 20,
        },
        this.moduleName
      );

      return results.map(node => {
        const labelText = this.formatLabel(node);
        return {
          id: node.nodeId,
          label: labelText,
          type: 'directory',
          path: node.path,
          module: node.moduleId
        };
      });
    } catch (error) {
      console.error(`[DirectoryMentionSource] Error getting suggestions:`, error);
      return [];
    }
  }

  /**
   * [新增] 格式化显示标签
   */
  private formatLabel(node: VNode): string {
    // 目录本身就是一个路径，如果只显示 name 可能会混淆
    // 例如 name: 'src', path: '/app/src' vs path: '/lib/src'
    
    if (this.moduleName) {
       // 单模块内，显示相对简化的信息，如果层级很深，显示完整路径更有帮助
       // 这里选择：显示名称 + (完整路径)
       return `📁 ${node.name} (${node.path})`; 
    }
    
    // 全局模式：显示名称 + ([模块] 完整路径)
    return `📁 ${node.name} ([${node.moduleId}] ${node.path})`;
  }

  /**
   * Provides a preview for a hovered directory link.
   * @param targetURL - The vfs://dir/... URI.
   * @returns A promise resolving to a hover preview object or null.
   */
  public async getHoverPreview(targetURL: URL | string): Promise<HoverPreviewData | null> {
    // [修复] 防御性检查和类型转换
    if (!targetURL) return null;
    
    let urlObj: URL;
    try {
        urlObj = typeof targetURL === 'string' ? new URL(targetURL) : targetURL;
    } catch(e) { 
        console.error('[DirectoryMentionSource] Invalid URL:', targetURL);
        return null; 
    }
    
    if (typeof urlObj.pathname === 'undefined') {
        console.warn('[DirectoryMentionSource] URL missing pathname:', urlObj);
        return null;
    }

    const dirId = urlObj.pathname.substring(1);
    try {
      const vfs = this.vfsCore.getVFS();
      const stat = await vfs.stat(dirId);
      // 注意：stat 对象中并没有 moduleId，需要从 VNode 获取，或者在 readdir 时一并返回
      // 这里简化处理，直接显示 stat 内容
      
      const children = await vfs.readdir(dirId);

      // 简单的文件/文件夹计数
      const fileCount = children.filter(c => c.type === VNodeType.FILE).length;
      const dirCount = children.length - fileCount;

      return {
        title: stat.name,
        contentHTML: `
          <div class="vfs-dir-preview">
            <div class="vfs-meta" style="font-size:0.8em; color:#888; margin-bottom:4px;">${stat.path}</div>
            <p>Contains ${children.length} item(s)</p>
            <ul>
              <li>Files: ${fileCount}</li>
              <li>Folders: ${dirCount}</li>
            </ul>
          </div>`,
        icon: '📁',
      };
    } catch (error) {
      return null;
    }
  }
}
