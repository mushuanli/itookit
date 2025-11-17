/**
 * @file vfs-ui/src/providers/DirectoryProvider.ts
 * @desc Implements IMentionProvider for directories, fetching data from vfs-core.
 */

// [修正] 导入正确的类型并使用别名 'as'
import { IMentionProvider, type Suggestion as AutocompleteSuggestion, type HoverPreviewData as HoverPreview } from '@itookit/common';
// [修正] 导入 VNodeType 枚举
import { VFSCore, VNode, VNodeType } from '@itookit/vfs-core';

/**
 * Dependencies required by the DirectoryProvider.
 */
export interface DirectoryProviderDependencies {
  vfsCore: VFSCore;
  moduleName: string;
}

/**
 * @class
 * @implements {IMentionProvider}
 * Provides autocompletion and hover previews for directories (folders).
 */
export class DirectoryProvider extends IMentionProvider {
  public readonly key = 'dir'; // Using 'dir' for brevity
  public readonly triggerChar = '@';

  private vfsCore: VFSCore;
  private moduleName: string;

  constructor({ vfsCore, moduleName }: DirectoryProviderDependencies) {
    super();
    if (!vfsCore || !moduleName) {
      throw new Error("DirectoryProvider requires a vfsCore instance and a moduleName.");
    }
    this.vfsCore = vfsCore;
    this.moduleName = moduleName;
  }

  /**
   * Provides directory suggestions based on a query.
   * @param query - The search string.
   * @returns A promise resolving to an array of directory suggestions.
   */
  public async getSuggestions(query: string): Promise<AutocompleteSuggestion[]> {
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
      }));
    } catch (error) {
      console.error(`[DirectoryProvider] Error getting suggestions for query "${query}":`, error);
      return [];
    }
  }

  /**
   * Provides a preview for a hovered directory link.
   * @param targetURL - The vfs://dir/... URI.
   * @returns A promise resolving to a hover preview object or null.
   */
  public async getHoverPreview(targetURL: URL): Promise<HoverPreview | null> {
    const dirId = targetURL.pathname.substring(1);
    try {
      const vfs = this.vfsCore.getVFS();
      const stat = await vfs.stat(dirId);
      const children = await vfs.readdir(dirId);

      return {
        title: stat.name,
        contentHTML: `<p>Contains ${children.length} item(s).</p>`,
        icon: '📁',
      };
    } catch (error) {
      return null;
    }
  }
}
