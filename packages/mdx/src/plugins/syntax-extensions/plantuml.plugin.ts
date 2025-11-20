/**
 * @file mdx/plugins/syntax-extensions/plantuml.plugin.ts
 * @desc 处理 PlantUML 代码块，将其转换为图片标签
 */

import type { MDxPlugin, PluginContext } from '../../core/plugin';

export interface PlantUMLPluginOptions {
    /**
     * PlantUML 服务器地址
     * @default 'https://www.plantuml.com/plantuml'
     */
    serverUrl?: string;

    /**
     * 输出格式
     * @default 'svg'
     */
    format?: 'svg' | 'png';
}

export class PlantUMLPlugin implements MDxPlugin {
    name = 'feature:plantuml';
    private options: Required<PlantUMLPluginOptions>;
    private cleanupFns: Array<() => void> = [];

    constructor(options: PlantUMLPluginOptions = {}) {
        this.options = {
            serverUrl: options.serverUrl?.replace(/\/$/, '') || 'https://www.plantuml.com/plantuml',
            format: options.format || 'svg',
        };
    }

    install(context: PluginContext): void {
        const removeListener = context.on('domUpdated', ({ element }: { element: HTMLElement }) => {
            this.processPlantUML(element);
        });
        this.cleanupFns.push(removeListener);
    }

    destroy(): void {
        this.cleanupFns.forEach(fn => fn());
        this.cleanupFns = [];
    }

    private processPlantUML(root: HTMLElement): void {
        // 查找 language-plantuml 或 language-puml
        const blocks = root.querySelectorAll('pre code.language-plantuml, pre code.language-puml');

        blocks.forEach((block) => {
            const pre = block.parentElement;
            if (!pre) return;

            const code = block.textContent || '';
            if (!code.trim()) return;

            // 编码代码
            const encoded = this.encodePlantUML(code.trim());
            const imageUrl = `${this.options.serverUrl}/${this.options.format}/~h${encoded}`;

            // 创建容器
            const container = document.createElement('div');
            container.className = 'mdx-plantuml-container';

            const img = document.createElement('img');
            img.src = imageUrl;
            img.alt = 'PlantUML Diagram';
            img.loading = 'lazy'; // 懒加载

            // 错误处理
            img.onerror = () => {
                container.innerHTML = `<div class="mdx-plantuml-error">PlantUML load failed</div>`;
                container.appendChild(pre); // 恢复显示代码
            };

            container.appendChild(img);
            pre.replaceWith(container);
        });
    }

    /**
     * 使用简单的 Hex 编码 (无需外部依赖)
     * PlantUML Server 支持 ~h 前缀的 Hex 编码字符串
     */
    private encodePlantUML(str: string): string {
        let result = '';
        // 将字符串转换为 UTF-8 字节序列
        const bytes = new TextEncoder().encode(str);
        for (let i = 0; i < bytes.length; i++) {
            // 转为 16 进制，不足2位补0
            result += bytes[i].toString(16).padStart(2, '0');
        }
        return result;
    }
}
