/**
 * @file mdx/plugins/core/asset-resolver.plugin.ts
 * @desc 负责将 @asset/ 路径解析为 Blob URL
 */
import type { MDxPlugin, PluginContext } from '../../core/plugin';
import { type ISessionEngine, type EngineNode, guessMimeType } from '@itookit/common';
import { extractFilenameFromPath, AssetConfigOptions } from '../../core/asset-helper';

export interface AssetResolverPluginOptions extends AssetConfigOptions {}

interface AssetCache {
    dirId: string;
    assets: Map<string, EngineNode>;
    timestamp: number;
}

export class AssetResolverPlugin implements MDxPlugin {
    name = 'core:asset-resolver';
    priority = 95; 
    
    private createdUrls: Set<string> = new Set();
    private assetCache: AssetCache | null = null;
    private readonly CACHE_TTL = 5000;

    constructor(_options: AssetResolverPluginOptions = {}) {
    }

    install(context: PluginContext): void {
        context.on('domUpdated', async (payload: { element: HTMLElement }) => {
            await this.resolveAssets(payload.element, context);
        });

        // 注册修剪命令，供外部手动调用
        context.registerCommand?.('pruneAssets', async () => {
            return await this.pruneUnusedAssets(context);
        });
    }

    private async resolveAssets(root: HTMLElement, context: PluginContext): Promise<void> {
        const engine = context.getSessionEngine?.();
        const ownerNodeId = context.getOwnerNodeId?.();

        if (!engine || !ownerNodeId) return;

        // ✅ 1. 获取资产目录 ID (Engine 负责计算)
        let assetDirId: string | null = null;
        try {
            assetDirId = await engine.getAssetDirectoryId(ownerNodeId);
        } catch (e) {
            console.debug('[AssetResolver] Failed to get asset dir ID:', e);
            return;
        }
        
        // 如果目录不存在 (Engine 返回 null)，说明没有资产，直接返回
        if (!assetDirId) return;

        // 2. 获取目录内容
        const assetsMap = await this.getAssetsMap(engine, assetDirId);
        if (assetsMap.size === 0) return;

        // 3. 扫描 DOM 节点并替换
        const elements = root.querySelectorAll<HTMLElement>('[src], [href]');
        const resolvePromises: Promise<void>[] = [];
        
        for (const el of elements) {
            const srcAttr = el.hasAttribute('src') ? 'src' : 'href';
            const rawUrl = el.getAttribute(srcAttr);

            if (!rawUrl || el.hasAttribute('data-original-src')) continue;

            // 仅处理 @asset/ 协议
            if (!rawUrl.startsWith('@asset/')) continue;

            const filename = extractFilenameFromPath(rawUrl);
            const targetNode = assetsMap.get(filename);
            
            if (!targetNode) continue;

            resolvePromises.push(
                this.resolveElement(el, srcAttr, rawUrl, targetNode, engine)
            );
        }

        await Promise.all(resolvePromises);
    }

    private async resolveElement(
        el: HTMLElement,
        srcAttr: string,
        rawUrl: string,
        node: EngineNode,
        engine: ISessionEngine
    ): Promise<void> {
        try {
            const content = await engine.readContent(node.id);
            if (!content) return;

            const mimeType = guessMimeType(node.name);
            const blob = new Blob([content], { type: mimeType });
            const blobUrl = URL.createObjectURL(blob);
            
            this.createdUrls.add(blobUrl);
            
            el.setAttribute(srcAttr, blobUrl);
            el.setAttribute('data-original-src', rawUrl);
            el.setAttribute('data-asset-id', node.id);
            
            // 移除 srcset 以防止浏览器加载错误图片
            if (el.tagName === 'IMG') {
                el.removeAttribute('srcset');
            }
        } catch (error) {
            console.warn('[AssetResolver] Resolve error:', node.name);
        }
    }

    private async getAssetsMap(
        engine: ISessionEngine, 
        dirId: string
    ): Promise<Map<string, EngineNode>> {
        const now = Date.now();
        if (this.assetCache && this.assetCache.dirId === dirId && now - this.assetCache.timestamp < this.CACHE_TTL) {
            return this.assetCache.assets;
        }

        try {
            const children = await engine.getChildren(dirId);
            const assets = new Map<string, EngineNode>();
            for (const child of children) {
                if (child.type === 'file') {
                    assets.set(child.name, child);
                }
            }
            this.assetCache = { dirId, assets, timestamp: now };
            return assets;
        } catch (error) {
            return new Map();
        }
    }

    /**
     * 清理当前文档中未引用的资产
     */
    private async pruneUnusedAssets(context: PluginContext): Promise<number> {
        const engine = context.getSessionEngine?.();
        const ownerNodeId = context.getOwnerNodeId?.();
        if (!engine || !ownerNodeId) return 0;

        const assetDirId = await engine.getAssetDirectoryId(ownerNodeId);
        if (!assetDirId) return 0;

        const pluginManager = context.pluginManager;
        const editor = (pluginManager as any).editorInstance;
        if (!editor) return 0;

        const content = editor.getText();
        
        // 提取引用：只关心 @asset/ 语法
        const usedFilenames = new Set<string>();
        const regex = /@asset\/([^\s)"']+)/g;
        let match;
        while ((match = regex.exec(content)) !== null) {
            usedFilenames.add(match[1]);
        }

        const assetsMap = await this.getAssetsMap(engine, assetDirId);
        const toDelete: string[] = [];

        for (const [filename, node] of assetsMap) {
            if (!usedFilenames.has(filename)) {
                toDelete.push(node.id);
            }
        }

        if (toDelete.length > 0) {
            await engine.delete(toDelete);
            // 清除缓存
            this.assetCache = null;
        }

        return toDelete.length;
    }

    destroy(): void {
        this.createdUrls.forEach(url => URL.revokeObjectURL(url));
        this.createdUrls.clear();
        this.assetCache = null;
    }
}
