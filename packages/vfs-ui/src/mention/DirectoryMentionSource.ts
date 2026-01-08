/**
 * @file vfs-ui/mention/DirectoryMentionSource.ts
 * @desc Implements IMentionSource for directories using ISessionEngine.
 */
import { type Suggestion, type HoverPreviewData } from '@itookit/common';
import { BaseMentionSource, MentionSourceDependencies } from './BaseMentionSource';

export type DirectorySourceDependencies = MentionSourceDependencies;

export class DirectoryMentionSource extends BaseMentionSource {
    public readonly key = 'dir';
    public readonly triggerChar = '@';

    public async getSuggestions(query: string): Promise<Suggestion[]> {
        try {
            const results = await this.engine.search({
                type: 'directory',
                text: query,
                limit: 20,
                scope: this.searchScope
            });

            return this.filterResults(results).map(node => {
                const modulePrefix = node.moduleId ? `[${node.moduleId}] ` : '';
                const icon = node.icon || '📁';
                return {
                    id: node.id,
                    label: `${icon} ${node.name} (${modulePrefix}${node.path})`,
                    title: node.name,
                    type: 'directory',
                    path: node.path,
                    module: node.moduleId
                };
            });
        } catch (error) {
            console.error('[DirectoryMentionSource] Error getting suggestions:', error);
            return [];
        }
    }

  /**
   * Provides a preview for a hovered directory link.
   * @param targetURL - The vfs://dir/... URI.
   * @returns A promise resolving to a hover preview object or null.
   */
    public async getHoverPreview(uri: string): Promise<HoverPreviewData | null> {
        const dirId = this.parseUri(uri);
        if (!dirId) return null;

        try {
            const node = await this.engine.getNode(dirId);
            if (!node) return null;

            const childrenCountText = node.children
                ? `Contains ${node.children.length} items`
                : 'Contents info not available';

            return {
                title: node.name,
                contentHTML: `
                    <div class="vfs-dir-preview">
                        <div class="vfs-meta" style="font-size:0.8em;color:#888;margin-bottom:4px;">${node.path}</div>
                        <p>${childrenCountText}</p>
                    </div>`,
                icon: node.icon || '📁',
            };
        } catch (error) {
            console.error('[DirectoryMentionSource] Error in getHoverPreview:', error);
            return null;
        }
    }
}
