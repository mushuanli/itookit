/**
 * @file mdx/plugins/syntax-extensions/vega.plugin.ts
 * @desc 支持 Vega 和 Vega-Lite 数据可视化图表
 */

import type { MDxPlugin, PluginContext } from '../../core/plugin';

declare global {
    interface Window {
        vega?: any;
        vegaLite?: any;
        vegaEmbed?: any;
    }
}

export interface VegaPluginOptions {
    /** Vega Embed CDN */
    embedCdnUrl?: string;
    /** Vega CDN */
    vegaCdnUrl?: string;
    /** Vega-Lite CDN */
    vegaLiteCdnUrl?: string;
    /** 默认主题: 'excel' | 'ggplot2' | 'quartz' | 'vox' | 'dark' */
    theme?: string;
    /** 是否显示操作菜单 (导出图片等) */
    actions?: boolean;
}

export class VegaPlugin implements MDxPlugin {
    name = 'feature:vega';
    private options: Required<VegaPluginOptions>;
    private cleanupFns: Array<() => void> = [];
    private isLoaded = false;
    private loadPromise: Promise<void> | null = null;

    constructor(options: VegaPluginOptions = {}) {
        this.options = {
            embedCdnUrl: options.embedCdnUrl || 'https://cdn.jsdelivr.net/npm/vega-embed@6',
            vegaCdnUrl: options.vegaCdnUrl || 'https://cdn.jsdelivr.net/npm/vega@5',
            vegaLiteCdnUrl: options.vegaLiteCdnUrl || 'https://cdn.jsdelivr.net/npm/vega-lite@5',
            theme: options.theme || 'quartz', // quartz 主题比较通用且好看
            actions: options.actions ?? false, // 默认关闭右下角的三点菜单
        };
    }

    install(context: PluginContext): void {
        const removeListener = context.on('domUpdated', ({ element }: { element: HTMLElement }) => {
            this.processVegaBlocks(element);
        });
        this.cleanupFns.push(removeListener);
    }

    destroy(): void {
        this.cleanupFns.forEach(fn => fn());
        this.cleanupFns = [];
    }

    /**
     * 动态加载依赖
     * 注意顺序：vega -> vega-lite -> vega-embed
     */
    private async loadDependencies(): Promise<void> {
        if (this.isLoaded) return;
        if (this.loadPromise) return this.loadPromise;

        this.loadPromise = (async () => {
            if (!window.vega) await import(/* @vite-ignore */ this.options.vegaCdnUrl);
            if (!window.vegaLite) await import(/* @vite-ignore */ this.options.vegaLiteCdnUrl);
            if (!window.vegaEmbed) await import(/* @vite-ignore */ this.options.embedCdnUrl);
            this.isLoaded = true;
        })();

        return this.loadPromise;
    }

    private async processVegaBlocks(root: HTMLElement): Promise<void> {
        const blocks = root.querySelectorAll('pre code.language-vega, pre code.language-vega-lite');

        if (blocks.length === 0) return;

        // 发现 Vega 代码块，开始加载资源
        try {
            await this.loadDependencies();
        } catch (e) {
            console.error('[VegaPlugin] Failed to load dependencies', e);
            return;
        }

        // [修复] 使用 Promise.all 替代 forEach，以正确处理异步操作并消除 TS 警告
        await Promise.all(Array.from(blocks).map(async (block) => {
            const pre = block.parentElement;
            if (!pre) return;

            const jsonString = block.textContent || '';
            const isLite = block.classList.contains('language-vega-lite');

            // 创建容器
            const container = document.createElement('div');
            container.className = 'mdx-vega-container';

            try {
                // 尝试解析 JSON，如果失败则保留代码块并报错
                const spec = JSON.parse(jsonString);

                // 替换 DOM
                pre.replaceWith(container);

        // 渲染图表
        if (window.vegaEmbed) {
           await window.vegaEmbed(container, spec, {
            mode: isLite ? 'vega-lite' : 'vega',
            theme: this.options.theme,
            actions: this.options.actions,
            renderer: 'svg',
          });
        }

            } catch (error: any) {
                console.warn('[VegaPlugin] Render error:', error);
                container.innerHTML = `
          <div class="mdx-vega-error">
            <strong>Vega JSON Error:</strong> ${error.message}
          </div>
        `;
                // 如果解析失败，把原始代码块放回去方便用户调试
                container.appendChild(pre.cloneNode(true));
                pre.replaceWith(container);
            }
    }));
    }
}
