/**
 * @file mdx/plugins/core/asset-resolver.plugin.ts
 * @desc 负责将 VFS 中的相对路径资源解析为浏览器可预览的 Blob URL
 */

import type { MDxPlugin, PluginContext } from '../../core/plugin';

export class AssetResolverPlugin implements MDxPlugin {
  name = 'core:asset-resolver';
  priority = 95; // 必须在 MediaPlugin 之前或之后，视情况而定。
  // MediaPlugin 生成的 HTML 可能是 <img src="@asset/...">，所以我们需要处理 DOM。

  private createdUrls: Set<string> = new Set();
  private context!: PluginContext;

  install(context: PluginContext): void {
    this.context = context;

    // 监听 DOM 更新事件 (Renderer 渲染完成后)
    context.on('domUpdated', async ({ element }: { element: HTMLElement }) => {
      await this.resolveAssets(element);
    });

    // 2. [新增] 注册清理命令
    context.registerCommand?.('pruneAssets', async (editor: any) => {
        await this.pruneUnusedAssets(editor);
    });
    
    // 可以在工具栏或标题栏加一个按钮 (可选)
    // context.registerTitleBarButton?.({ ... });
  }

  /**
   * 扫描并替换 DOM 中的 VFS 路径
   */
  private async resolveAssets(root: HTMLElement): Promise<void> {
    const engine = this.context.getSessionEngine ? this.context.getSessionEngine():undefined;
    const currentNodeId = this.context.getCurrentNodeId();
    
    if (!engine || !currentNodeId) return;

    // 获取当前节点，为了计算相对路径的基准 (虽然 VFS 设计中资源通常是 .filename/xxx)
    const ownerNode = await engine.getNode(currentNodeId);
    if (!ownerNode) return;

    // 1. 计算伴生目录的物理名称：.ownerName
    // 例如 ownerNode.name = "test.md", sidecarDir = ".test.md"
    const sidecarDirName = `.${ownerNode.name}`;

    const elements = root.querySelectorAll<HTMLElement>('[src], [href]');
    
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      const srcAttr = el.hasAttribute('src') ? 'src' : 'href';
      const rawUrl = el.getAttribute(srcAttr);

      if (!rawUrl) continue;

      // [核心修改] 拦截 @asset/ 前缀
      if (rawUrl.startsWith('@asset/')) {
          const filename = rawUrl.replace('@asset/', '');
          
          try {
             // 2. 构造 VFS 真实路径
             // 逻辑：当前文件父目录 + 伴生目录名 + 文件名
             // ownerNode.path = "/docs/test.md"
             // realPath = "/docs/.test.md/image.png"
             
             const parentPath = ownerNode.path.substring(0, ownerNode.path.lastIndexOf('/'));
             // 处理根目录情况
             const basePath = parentPath === '' ? '' : parentPath;
             const fullVfsPath = `${basePath}/${sidecarDirName}/${filename}`;

             // 3. 获取 Blob
             // 这里我们需要 Engine 提供一个通过 Path 获取 Blob 的能力
             // 如果 Engine 没有暴露 resolvePath，我们只能尝试遍历或者 hack
             
             // 假设我们在 VFSModuleEngine 中增加了 resolveAsset(ownerId, filename) 更好？
             // 为了解耦，我们尝试扩展 Engine 接口，或者使用现有的 search/readContent
             
             // [Hack] 尝试直接通过 engine 读取 (如果 engine 支持路径读取最好，不支持则需先 resolve ID)
             // 我们在 UploadPlugin 阶段其实知道 ID，但这里是渲染阶段，只有 URL。
             
             // 最佳实践：扩展 ISessionEngine 增加 getAssetContent(ownerId, filename)
             // 但为了不改动太多接口，我们使用一个约定的 resolve 逻辑
             
             let assetContent: string | ArrayBuffer | null = null;
             
             // 尝试调用 engine.readContentByPath (如果存在)
             if ('readContentByPath' in engine) {
                 assetContent = await (engine as any).readContentByPath(fullVfsPath);
             } 
             // 否则尝试解析 ID (VFSModuleEngine 特有)
             else if ('resolvePath' in engine) {
                 const assetId = await (engine as any).resolvePath(fullVfsPath);
                 if (assetId) {
                     assetContent = await engine.readContent(assetId);
                 }
             }

             if (assetContent) {
                 const mimeType = this.guessMimeType(filename);
                 // 必须指定 MIME 类型，否则浏览器可能无法正确渲染图片
                 const blob = new Blob([assetContent], { type: mimeType });
                 const blobUrl = URL.createObjectURL(blob);
                 
                 this.createdUrls.add(blobUrl);
                 
                 el.setAttribute(srcAttr, blobUrl);
                 el.setAttribute('data-original-src', rawUrl);
                 
                 // [Fix] 如果是 Image，可能需要重置 srcset 以防干扰
                 if (el.tagName === 'IMG') {
                     el.removeAttribute('srcset');
                 }
             } else {
                 console.warn(`[AssetResolver] Asset not found: ${fullVfsPath}`);
                 // 可以设置一个 404 图片
                 // el.setAttribute(srcAttr, 'path/to/404.png');
             }

          } catch (e) {
              console.warn('[AssetResolver] Failed to resolve:', rawUrl, e);
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

  /**
   * 清理未引用的资源
   */
  private async pruneUnusedAssets(editor: any): Promise<void> {
      const engine = this.context.getSessionEngine?.();
      const currentNodeId = this.context.getCurrentNodeId();
      if (!engine || !currentNodeId) return;

      if (!confirm('确定要清理未引用的附件吗？此操作不可撤销。')) return;

      try {
          // 1. 获取所有附件
          // 需要 Engine 提供 listAssets 接口，或者 getAssetDirectoryId 后 list children
          let assetDirId: string | null = null;
          if ('getAssetDirectoryId' in engine) {
              assetDirId = await (engine as any).getAssetDirectoryId(currentNodeId);
          }
          
          if (!assetDirId) {
              alert('当前文档没有资源目录。');
              return;
          }
          
          // 2. 获取目录下的所有文件 (利用我们在 ISessionEngine 中新增的 getChildren)
          let assets: any[] = [];
          if (engine.getChildren) {
              assets = await engine.getChildren(assetDirId);
          } else {
              console.warn('[AssetResolver] Engine does not support getChildren, cannot prune.');
              return;
          }
          
          if (assets.length === 0) {
              alert('资源目录为空。');
              return;
          }

          // 3. 扫描 Markdown 文本中的引用
          const content = editor.getText();
          // 匹配 @asset/filename
          const usedAssets = new Set<string>();
          const regex = /@asset\/([^\s)"]+)/g;
          let match;
          while ((match = regex.exec(content)) !== null) {
              usedAssets.add(match[1]);
          }
          
          // 4. 比较并删除
          let deletedCount = 0;
          for (const asset of assets) {
              // 确保只处理文件，且不在引用列表中
              if (asset.type === 'file' && !usedAssets.has(asset.name)) {
                  await engine.delete([asset.id]);
                  deletedCount++;
              }
          }
          
          alert(`清理完成，删除了 ${deletedCount} 个未引用文件。`);

      } catch (e) {
          console.error('Prune failed', e);
          alert('清理失败，请查看控制台。');
      }
  }

  destroy(): void {
    // 清理 Blob URLs
    this.createdUrls.forEach(url => URL.revokeObjectURL(url));
    this.createdUrls.clear();
  }
}
