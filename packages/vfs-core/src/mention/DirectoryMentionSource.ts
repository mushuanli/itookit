/**
 * @file vfs-core/mention/DirectoryMentionSource.ts
 * @desc Implements IMentionSource for directories, fetching data from vfs-core.
 */

// [修正] 导入正确的类型并使用别名 'as'
import { 
  IMentionSource, 
  type Suggestion, 
  type HoverPreviewData 
} from '@itookit/common';
// [修正] 导入 VNodeType 枚举
import { VFSCore } from '../VFSCore';
import { VNode, VNodeType } from '../store/types.js';

/**
 * Dependencies required by the DirectoryMentionSource.
 */
export interface DirectorySourceDependencies {
  vfsCore: VFSCore;
  moduleName: string;
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
  private moduleName: string;

  constructor({ vfsCore, moduleName }: DirectorySourceDependencies) {
    super();
    if (!vfsCore || !moduleName) {
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
      // Again, assumes an efficient search method in vfs-core
      const results: VNode[] = await this.vfsCore.searchNodes(this.moduleName, {
        type: VNodeType.DIRECTORY,
        nameContains: query,
        limit: 10,
      });

      return results.map(node => ({
        id: node.nodeId,
        label: `📁 ${node.name}`,
        type: 'directory',
        path: node.path
      }));
    } catch (error) {
      console.error(`[DirectoryMentionSource] Error getting suggestions for query "${query}":`, error);
      return [];
    }
  }

  /**
   * Provides a preview for a hovered directory link.
   * @param targetURL - The vfs://dir/... URI.
   * @returns A promise resolving to a hover preview object or null.
   */
  public async getHoverPreview(targetURL: URL): Promise<HoverPreviewData | null> {
    const dirId = targetURL.pathname.substring(1);
    try {
      const vfs = this.vfsCore.getVFS();
      const stat = await vfs.stat(dirId);
      const children = await vfs.readdir(dirId);

      // 简单的文件/文件夹计数
      const fileCount = children.filter(c => c.type === VNodeType.FILE).length;
      const dirCount = children.length - fileCount;

      return {
        title: stat.name,
        contentHTML: `
          <div class="vfs-dir-preview">
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
