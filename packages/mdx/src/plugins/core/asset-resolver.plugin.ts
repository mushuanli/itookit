/**
 * @file mdx/plugins/core/asset-resolver.plugin.ts
 * @desc 负责将 @asset/ 路径解析为 Blob URL
 */
import type { MDxPlugin, PluginContext } from '../../core/types';
import type { AssetConfigOptions } from '../../services/asset-helper';
import { guessMimeType } from '@itookit/vfs-core';
import { createMDXFile } from '@itookit/vfs-core';

export interface AssetResolverPluginOptions extends AssetConfigOptions { }

export class AssetResolverPlugin implements MDxPlugin {
    name = 'core:asset-resolver';
    priority = 95;

    private createdUrls: Set<string> = new Set();

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
        const fs = context.getFileSystem?.();
        const ownerNodeId = context.getOwnerNodeId?.();
        const assets = context.getAssetFileSystem?.();
        if (!assets && (!fs || !ownerNodeId)) return;
        const read = (name: string) => assets
            ? assets.driver.readContent('/' + name, { encoding: 'binary' })
            : createMDXFile(fs!, ownerNodeId!).asset(name).read();

        const elements = root.querySelectorAll<HTMLElement>('[src], [href]');
        const resolvePromises: Promise<void>[] = [];

        for (const el of elements) {
            const srcAttr = el.hasAttribute('src') ? 'src' : 'href';
            const rawUrl = el.getAttribute(srcAttr);

            if (!rawUrl || el.hasAttribute('data-original-src')) continue;
            if (!rawUrl.startsWith('@asset/')) continue;

            const name = rawUrl.slice('@asset/'.length);

            resolvePromises.push(
                read(name).then((data) => {
                    if (!data) return;
                    const mimeType = guessMimeType(name);
                    const blobUrl = URL.createObjectURL(new Blob([data], { type: mimeType }));
                    this.createdUrls.add(blobUrl);

                    el.setAttribute(srcAttr, blobUrl);
                    el.setAttribute('data-original-src', rawUrl);

                    if (el.tagName === 'IMG') {
                        el.removeAttribute('srcset');
                    }
                }).catch(() => {
                    console.warn('[AssetResolver] Resolve error:', name);
                })
            );
        }

        await Promise.all(resolvePromises);
    }

    /**
     * 清理当前文档中未引用的资产
     */
    private async pruneUnusedAssets(context: PluginContext): Promise<number> {
        const fs = context.getFileSystem?.();
        const ownerNodeId = context.getOwnerNodeId?.();
        if (!fs || !ownerNodeId) return 0;

        const fileIO = createMDXFile(fs, ownerNodeId);
        return fileIO.pruneUnusedAssets();
    }

    destroy(): void {
        this.createdUrls.forEach(url => URL.revokeObjectURL(url));
        this.createdUrls.clear();
    }
}
