/**
 * @file vfs-ui/mention/FileMentionSource.ts
 * @desc Implements IMentionSource for files using the generic ISessionEngine.
 */
import { escapeHTML, type Suggestion, type HoverPreviewData, type EngineNode } from '@itookit/common';
import { BaseMentionSource, MentionSourceDependencies } from './BaseMentionSource';

export type FileSourceDependencies = MentionSourceDependencies;

export class FileMentionSource extends BaseMentionSource {
    public readonly key = 'file';
    public readonly triggerChar = '@';

    public async getSuggestions(query: string): Promise<Suggestion[]> {
        try {
            const results = await this.engine.search({
                type: 'file',
                text: query,
                limit: 20,
                scope: this.searchScope
            });

            return this.filterResults(results).map(node => ({
                id: node.id,
                label: this.formatLabel(node),
                title: node.name,
                type: 'file',
                path: node.path,
                module: node.moduleId
            }));
        } catch (error) {
            console.error('[FileMentionSource] Error getting suggestions:', error);
            return [];
        }
    }

  /**
   * 格式化显示标签，处理同名文件冲突
   */
    private formatLabel(node: EngineNode): string {
        const parentPath = node.path.substring(0, node.path.lastIndexOf('/')) || '/';
        const context = parentPath === '/' ? '' : ` ${parentPath}`;
        const modulePrefix = node.moduleId ? `[${node.moduleId}]` : '';
        const icon = node.icon || '📄';
        return `${icon} ${node.name} (${modulePrefix}${context})`;
    }

  /**
   * ✅ 修复：接受字符串 URI，返回统一的类型
   */
    public async getHoverPreview(uri: string): Promise<HoverPreviewData | null> {
        const fileId = this.parseUri(uri);
        if (!fileId) return null;

        try {
            const [node, content] = await Promise.all([
                this.engine.getNode(fileId),
                this.engine.readContent(fileId)
            ]);

            if (!node) return null;

            const textContent = typeof content === 'string'
                ? content
                : new TextDecoder().decode(content as ArrayBuffer);

            const summary = textContent.substring(0, 150)
                .replace(/[\r\n]+/g, ' ')
                .replace(/([#*`])/g, '')
                + (textContent.length > 150 ? '...' : '');

            const dateStr = new Date(node.modifiedAt).toLocaleDateString();
            const moduleBadge = node.moduleId
                ? `<span style="background:#eee;padding:2px 4px;border-radius:3px;font-size:0.8em;margin-right:5px;">${node.moduleId}</span>`
                : '';

            return {
                title: node.name,
                contentHTML: `
                    <div class="vfs-hover-preview" style="font-size:0.9em;line-height:1.4;">
                        <div style="margin-bottom:6px;color:#666;font-size:0.85em;display:flex;align-items:center;">
                            ${moduleBadge}
                            <span style="font-family:monospace;">${node.path}</span>
                        </div>
                        <div style="margin-bottom:8px;color:#333;">${escapeHTML(summary)}</div>
                        <div style="color:#999;font-size:0.8em;border-top:1px solid #eee;padding-top:4px;">
                            Updated: ${dateStr}
                        </div>
                    </div>`,
                icon: node.icon || '📄'
            };
        } catch (error) {
            console.error('[FileMentionSource] Error in getHoverPreview:', error);
            return null;
        }
    }

  /**
   * Provides raw data for headless processing by tools like MDxProcessor.
   * @param targetURL - The vfs://file/... URI.
   * @returns A promise resolving to the file's data or null.
   */
    public async getDataForProcess(targetURL: URL): Promise<any | null> {
        const fileId = targetURL?.pathname?.substring(1);
        if (!fileId) return null;

        try {
            const node = await this.engine.getNode(fileId);
            if (!node) return null;

            const content = await this.engine.readContent(fileId);
            return {
                id: node.id,
                title: node.name,
                content,
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
}
