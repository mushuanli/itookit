/**
 * @file mdx/plugins/syntax-extensions/svg.plugin.ts
 * @desc 处理 SVG 代码块的插件，支持将 ```svg 代码块渲染为内联 SVG。
 */

import type { MDxPlugin, PluginContext } from '../../core/plugin';

export interface SvgPluginOptions {
    /**
     * 是否启用基础的 XSS 清理（移除 script 标签和事件处理器）
     * @default true
     */
    sanitize?: boolean;

    /**
     * SVG 容器的自定义类名
     * @default 'mdx-svg-container'
     */
    containerClass?: string;
}

export class SvgPlugin implements MDxPlugin {
    name = 'feature:svg';
    private options: Required<SvgPluginOptions>;
    private cleanupFns: Array<() => void> = [];

    constructor(options: SvgPluginOptions = {}) {
        this.options = {
            sanitize: options.sanitize ?? true,
            containerClass: options.containerClass ?? 'mdx-svg-container',
        };
    }

    install(context: PluginContext): void {
        // 监听 domUpdated 事件，在渲染后处理代码块
        const removeListener = context.on('domUpdated', ({ element }: { element: HTMLElement }) => {
            this.processSvgCodeBlocks(element);
        });

        if (removeListener) {
            this.cleanupFns.push(removeListener);
        }
    }

    destroy(): void {
        this.cleanupFns.forEach(fn => fn());
        this.cleanupFns = [];
    }

    /**
     * 处理 SVG 代码块
     */
    private processSvgCodeBlocks(rootElement: HTMLElement): void {
        // 查找所有语言为 svg 的代码块
        // marked 通常渲染为 <pre><code class="language-svg">...</code></pre>
        const codeBlocks = rootElement.querySelectorAll('pre code.language-svg');

        codeBlocks.forEach((block) => {
            const preElement = block.parentElement;
            if (!preElement) return;

            const rawSvg = block.textContent || '';
            const cleanSvg = this.options.sanitize ? this.sanitizeSvg(rawSvg) : rawSvg;

            // 创建容器
            const container = document.createElement('div');
            container.className = this.options.containerClass;

            // 可以在这里添加 CSS 样式，或者通过外部 CSS 控制
            container.style.display = 'inline-block';
            container.style.maxWidth = '100%';

            // 尝试解析 SVG 以检查有效性
            if (this.isValidSvg(cleanSvg)) {
                container.innerHTML = cleanSvg;

                // 替换原来的 pre 元素
                preElement.replaceWith(container);
            } else {
                // 如果无效，可以选择保留代码块并显示错误，或者不做处理
                console.warn('[SvgPlugin] Invalid or unsafe SVG content detected.');
            }
        });
    }

    /**
     * 基础的 SVG 清理
     * 注意：生产环境建议使用 DOMPurify 等专业库
     */
    private sanitizeSvg(svg: string): string {
        let clean = svg;

        // 1. 移除 <script> 标签
        clean = clean.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gim, '');

        // 2. 移除 on* 事件处理器 (如 onclick, onload)
        clean = clean.replace(/\s(on\w+)="[^"]*"/gim, '');
        clean = clean.replace(/\s(on\w+)='[^']*'/gim, '');

        // 3. 移除 javascript: 链接
        clean = clean.replace(/href=["']javascript:[^"']*["']/gim, 'href="#"');

        return clean;
    }

    /**
     * 检查是否包含基本的 svg 标签
     */
    private isValidSvg(content: string): boolean {
        const trimmed = content.trim();
        return trimmed.startsWith('<svg') && trimmed.endsWith('</svg>');
    }
}
