/**
 * @file vfs-ui/mention/DirectoryMentionSource.ts
 * @desc Implements IMentionSource for directories using ISessionEngine.
 */

import { 
  IMentionSource, 
  type Suggestion, 
  type HoverPreviewData,
  type ISessionEngine,
  type EngineNode
} from '@itookit/common';

/**
 * Dependencies required by the DirectoryMentionSource.
 */
export interface DirectorySourceDependencies {
  engine: ISessionEngine;
  /** 是否进行全局搜索，默认为 true */
  globalSearch?: boolean;
}

/**
 * @class
 * @implements {IMentionSource}
 * Provides autocompletion and hover previews for directories (folders).
 */
export class DirectoryMentionSource extends IMentionSource {
  public readonly key = 'dir';
  public readonly triggerChar = '@';

  private engine: ISessionEngine;
  private globalSearch: boolean;

  constructor({ engine, globalSearch = true }: DirectorySourceDependencies) {
    super();
    if (!engine) {
      throw new Error("DirectoryMentionSource requires an ISessionEngine instance.");
    }
    this.engine = engine;
    this.globalSearch = globalSearch;
  }

  /**
   * Provides directory suggestions based on a query.
   * @param query - The search string.
   * @returns A promise resolving to an array of directory suggestions.
   */
  public async getSuggestions(query: string): Promise<Suggestion[]> {
    try {
      const results: EngineNode[] = await this.engine.search({
          type: 'directory',
          text: query,
          limit: 20,
          scope: this.globalSearch ? ['*'] : undefined
      });

      const filteredResults = results.filter(node => {
        // [优化] 过滤逻辑同步更新
        if (node.moduleId && (node.moduleId.startsWith('.') || node.moduleId.startsWith('__'))) {
          return false;
        }
        if (node.path && node.path.split('/').some(part => (part.startsWith('.') || part.startsWith('__')))) {
          return false;
        }
        if (node.name.startsWith('.') || node.name.startsWith('__')) {
            return false;
        }
        return true;
      });

      return filteredResults.map(node => {
        const modulePrefix = node.moduleId ? `[${node.moduleId}] ` : '';
        const icon = node.icon || '📁';
        const labelText = `${icon} ${node.name} (${modulePrefix}${node.path})`;
        
        return {
          id: node.id,
          label: labelText,
          title: node.name,
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
   * Provides a preview for a hovered directory link.
   * @param targetURL - The vfs://dir/... URI.
   * @returns A promise resolving to a hover preview object or null.
   */
  public async getHoverPreview(uri: string): Promise<HoverPreviewData | null> {
    if (!uri) return null;
    
    let urlObj: URL;
    try { 
      urlObj = new URL(uri); 
    } catch(e) { 
      return null; 
    }
    
    if (!urlObj.pathname) return null;

    const dirId = urlObj.pathname.substring(1);
    
    try {
      const node = await this.engine.getNode(dirId);
      if (!node) return null;

      const childrenCountText = node.children 
        ? `Contains ${node.children.length} items` 
        : 'Contents info not available';

      // ✅ 修复：返回统一的数据结构
      const previewData: HoverPreviewData = {
        title: node.name,
        contentHTML: `
          <div class="vfs-dir-preview">
            <div class="vfs-meta" style="font-size:0.8em; color:#888; margin-bottom:4px;">${node.path}</div>
            <p>${childrenCountText}</p>
          </div>`,
        icon: node.icon || '📁',
      };

      console.log('[DirectoryMentionSource] Returning preview data for:', node.name);
      return previewData;
      
    } catch (error) {
      console.error('[DirectoryMentionSource] Error inside getHoverPreview:', error);
      return null;
    }
  }
}
