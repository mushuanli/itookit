/**
 * @file mdx/plugins/core/asset-resolver.plugin.ts
 * @desc 负责将资源路径 (@asset/ 或 ./) 解析为 Blob URL
 */
import type { MDxPlugin, PluginContext } from '../../core/plugin';
import { resolveAssetDirectory, AssetConfigOptions } from '../../core/asset-helper';

export interface AssetResolverPluginOptions extends AssetConfigOptions {}

export class AssetResolverPlugin implements MDxPlugin {
  name = 'core:asset-resolver';
  priority = 95; 
  private createdUrls: Set<string> = new Set();
  private options: AssetResolverPluginOptions;

  constructor(options: AssetResolverPluginOptions = {}) {
      this.options = options;
  }

  install(context: PluginContext): void {
    // [修复] 显式定义 payload 类型
    context.on('domUpdated', async (payload: any) => {
      const { element } = payload as { element: HTMLElement };
      await this.resolveAssets(element, context);
    });
  }

  private async resolveAssets(root: HTMLElement, context: PluginContext): Promise<void> {
    const engine = context.getSessionEngine ? context.getSessionEngine() : undefined;
    const currentNodeId = context.getCurrentNodeId();
    
    if (!engine || !currentNodeId) return;

    // ✨ 1. 解析资源根目录
    const assetDirId = await resolveAssetDirectory(engine, currentNodeId, this.options);
    if (!assetDirId) return;

    // 缓存目录下的文件列表，减少多次调用 getChildren
    let dirAssets: any[] = [];
    try {
        dirAssets = await engine.getChildren(assetDirId);
    } catch (e) {
        // console.warn('AssetResolver: cannot list children of', assetDirId);
        return;
    }

    const elements = root.querySelectorAll<HTMLElement>('[src], [href]');
    
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      const srcAttr = el.hasAttribute('src') ? 'src' : 'href';
      const rawUrl = el.getAttribute(srcAttr);

      if (!rawUrl) continue;

      // ✨ 2. 识别目标文件名
      let targetFilename: string | null = null;

      if (rawUrl.startsWith('@asset/')) {
          targetFilename = rawUrl.replace('@asset/', '');
      } else if (rawUrl.startsWith('./')) {
          // ✅ [修复] 兼容路径中包含目录的情况 (e.g. ./attach/image.png)
          // 如果我们的 assetDirId 已经指向了 ./attach 目录，
          // 我们只需要提取最后的文件名部分。
          const parts = rawUrl.split('/');
          targetFilename = parts[parts.length - 1]; 
      } else if (!rawUrl.includes('/') && !rawUrl.startsWith('http') && !rawUrl.startsWith('data:') && !rawUrl.startsWith('#')) {
           // 纯文件名
           targetFilename = rawUrl;
      }

      if (targetFilename) {
          try {
             // 3. 在缓存中查找文件节点
             const targetNode = dirAssets.find(n => n.name === targetFilename && n.type === 'file');

             if (targetNode) {
                 const assetContent = await engine.readContent(targetNode.id);
                 if (assetContent) {
                     const mimeType = this.guessMimeType(targetFilename!);
                     const blob = new Blob([assetContent], { type: mimeType });
                     const blobUrl = URL.createObjectURL(blob);
                     
                     this.createdUrls.add(blobUrl);
                     
                     el.setAttribute(srcAttr, blobUrl);
                     el.setAttribute('data-original-src', rawUrl);
                     
                     if (el.tagName === 'IMG') {
                         el.removeAttribute('srcset');
                     }
                 }
             }
          } catch (e) {
              // ignore
          }
      }
    }
  }

  private guessMimeType(filename: string): string {
        const ext = filename.split('.').pop()?.toLowerCase();
        const map: Record<string, string> = {
            'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
            'gif': 'image/gif', 'svg': 'image/svg+xml', 'webp': 'image/webp',
            'pdf': 'application/pdf', 'doc': 'application/msword',
            'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'mp4': 'video/mp4', 'webm': 'video/webm'
        };
        return map[ext || ''] || 'application/octet-stream';
  }

  destroy(): void {
    this.createdUrls.forEach(url => URL.revokeObjectURL(url));
    this.createdUrls.clear();
  }
}