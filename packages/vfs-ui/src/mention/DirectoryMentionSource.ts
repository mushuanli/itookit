/**
 * @file vfs-ui/mention/DirectoryMentionSource.ts
 * @desc Implements IMentionSource for directories using ISessionEngine.
 */
import { type Suggestion, type HoverPreviewData } from '@itookit/common';
import { BaseMentionSource, MentionSourceDependencies } from './BaseMentionSource';

export type DirectorySourceDependencies = MentionSourceDependencies;

export class DirectoryMentionSource extends BaseMentionSource {
  readonly key = 'dir';
  readonly triggerChar = '@';

  async getSuggestions(query: string): Promise<Suggestion[]> {
    try {
      const results = await this.engine.search({ type: 'directory', text: query, limit: 20, scope: this.searchScope });
      return this.filterResults(results).map(node => ({
        id: node.id,
        label: `${node.icon || '📁'} ${node.name} (${node.moduleId ? `[${node.moduleId}] ` : ''}${node.path})`,
        title: node.name,
        type: 'directory',
        path: node.path,
        module: node.moduleId
      }));
    } catch (e) {
      console.error('[DirectoryMentionSource] Error:', e);
      return [];
    }
  }

  /**
   * Provides a preview for a hovered directory link.
   * @param targetURL - The vfs://dir/... URI.
   * @returns A promise resolving to a hover preview object or null.
   */
  async getHoverPreview(uri: string): Promise<HoverPreviewData | null> {
    const dirId = this.parseUri(uri);
    if (!dirId) return null;

    try {
      const node = await this.engine.getNode(dirId);
      if (!node) return null;

      const childText = node.children ? `Contains ${node.children.length} items` : 'Contents info not available';
      return {
        title: node.name,
        icon: node.icon || '📁',
        contentHTML: `<div class="vfs-dir-preview"><div class="vfs-meta" style="font-size:0.8em;color:#888;margin-bottom:4px;">${node.path}</div><p>${childText}</p></div>`
      };
    } catch (e) {
      console.error('[DirectoryMentionSource] getHoverPreview error:', e);
      return null;
    }
  }
}
