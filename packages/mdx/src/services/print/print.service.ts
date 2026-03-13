// @file: mdx/core/print.service.ts

import { MDxRenderer } from '../../renderer/mdx-renderer';
import type { ISessionEngine } from '@itookit/common';

// ✅ 从常量文件导入样式
import { PRINT_STYLES } from './print.styles';

/**
 * 打印配置选项
 */
export interface PrintOptions {
    /** 文档标题 */
    title?: string;

    /** 自定义样式（CSS 字符串或数组） */
    styles?: string | string[];

    /** 是否显示页眉 */
    showHeader?: boolean;

    /** 页眉元数据 */
    headerMeta?: {
        author?: string;
        date?: string;
        version?: string;
        [key: string]: string | undefined;
    };

    /** 打印前的 HTML 处理钩子 */
    beforePrint?: (html: string) => string;

    /** 打印后是否自动关闭预览窗口 */
    autoClose?: boolean;

    /** 布局变体 */
    variant?: 'default' | 'compact';

    /** 纸张大小 */
    pageSize?: 'A4' | 'Letter' | 'Legal';
}

/**
 * 打印服务接口
 */
export interface PrintService {
    /**
     * 将 Markdown 渲染为可打印的 HTML
     */
    renderForPrint(markdown: string, options?: PrintOptions): Promise<string>;

    /**
     * 打开打印预览窗口并触发打印（从 Markdown 渲染）
     */
    print(markdown: string, options?: PrintOptions): Promise<void>;

    /**
     * ✅ [新增] 直接使用 HTML 内容打印（跳过渲染步骤）
     */
    printFromHtml(html: string, options?: PrintOptions): Promise<void>;

    /**
     * 销毁服务，释放资源
     */
    destroy?(): void;
}

/**
 * 默认打印服务实现
 * 
 * 使用 MDxRenderer 确保渲染结果与编辑器一致，
 * 并应用 BEM 命名的打印专用样式。
 */
export class DefaultPrintService implements PrintService {
    private renderer: MDxRenderer | null = null;
    private sessionEngine?: ISessionEngine;
    private nodeId?: string;

    constructor(sessionEngine?: ISessionEngine, nodeId?: string) {
        this.sessionEngine = sessionEngine;
        this.nodeId = nodeId;
    }

    /**
     * 延迟初始化渲染器
     */
    private getRenderer(): MDxRenderer {
        if (!this.renderer) {
            this.renderer = new MDxRenderer({
                sessionEngine: this.sessionEngine,
                nodeId: this.nodeId,
            });
        }
        return this.renderer;
    }

    /**
     * 获取完整的打印样式
     */
    private getStyles(options: PrintOptions): string {
        // ✅ 使用导入的常量
        let styles = PRINT_STYLES;

        // 添加页面大小样式
        if (options.pageSize && options.pageSize !== 'A4') {
            styles += `\n@page { size: ${options.pageSize}; }`;
        }

        // 添加自定义样式
        if (options.styles) {
            const customStyles = Array.isArray(options.styles)
                ? options.styles.join('\n')
                : options.styles;
            styles += '\n/* Custom Styles */\n' + customStyles;
        }

        return styles;
    }

    /**
     * 构建页眉 HTML
     */
    private buildHeader(options: PrintOptions): string {
        if (!options.showHeader) {
            return '';
        }

        const title = options.title || 'Untitled Document';
        const meta = options.headerMeta || {};

        let metaItems = '';

        if (meta.author) {
            metaItems += `<span class="mdx-print-header__meta-item">${this.escapeHtml(meta.author)}</span>`;
        }

        if (meta.date) {
            metaItems += `<span class="mdx-print-header__meta-item">${this.escapeHtml(meta.date)}</span>`;
        } else {
            metaItems += `<span class="mdx-print-header__meta-item">${new Date().toLocaleDateString()}</span>`;
        }

        if (meta.version) {
            metaItems += `<span class="mdx-print-header__meta-item">v${this.escapeHtml(meta.version)}</span>`;
        }

        return `
            <header class="mdx-print-header">
                <h1 class="mdx-print-header__title">${this.escapeHtml(title)}</h1>
                ${metaItems ? `<div class="mdx-print-header__meta">${metaItems}</div>` : ''}
            </header>
        `;
    }

    /**
     * 渲染 Markdown 为可打印的 HTML
     */
    async renderForPrint(markdown: string, options: PrintOptions = {}): Promise<string> {
        const renderer = this.getRenderer();

        // 创建临时容器进行渲染
        const tempContainer = document.createElement('div');
        tempContainer.style.cssText = 'position:absolute;left:-9999px;visibility:hidden;';
        document.body.appendChild(tempContainer);

        try {
            // 使用 MDxRenderer 渲染
            await renderer.render(tempContainer, markdown);
            let html = tempContainer.innerHTML;

            // 应用前置处理钩子
            if (options.beforePrint) {
                html = options.beforePrint(html);
            }

            return html;
        } finally {
            document.body.removeChild(tempContainer);
        }
    }

    /**
     * 打开打印预览窗口
     */
    async print(markdown: string, options: PrintOptions = {}): Promise<void> {
        const contentHtml = await this.renderForPrint(markdown, options);
        await this.printFromHtml(contentHtml, options);
    }

    /**
     * ✅ [新增] 直接使用 HTML 内容打印
     */
    async printFromHtml(contentHtml: string, options: PrintOptions = {}): Promise<void> {
        const title = options.title || 'Print';
        const styles = this.getStyles(options);
        const header = this.buildHeader(options);

        // 确定变体类名
        const variantClass = options.variant === 'compact' ? 'mdx-print--compact' : '';
        const headerClass = options.showHeader === false ? 'mdx-print--no-header' : '';

        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            throw new Error('Failed to open print window. Please check popup blocker settings.');
        }

        const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${this.escapeHtml(title)}</title>
    <style>${styles}</style>
</head>
<body>
    <article class="mdx-print ${variantClass} ${headerClass}">
        ${header}
        <main class="mdx-print-content">
            ${contentHtml}
        </main>
    </article>
</body>
</html>`;

        printWindow.document.write(fullHtml);
        printWindow.document.close();

        // 等待资源加载
        await this.waitForResources(printWindow);

        printWindow.focus();
        printWindow.print();

        if (options.autoClose) {
            // 延迟关闭，确保打印对话框有时间显示
            setTimeout(() => printWindow.close(), 1000);
        }
    }

    /**
     * 等待窗口资源加载完成
     */
    private waitForResources(win: Window): Promise<void> {
        return new Promise((resolve) => {
            if (win.document.readyState === 'complete') {
                setTimeout(resolve, 500);
            } else {
                win.addEventListener('load', () => setTimeout(resolve, 500));
            }
        });
    }

    /**
     * HTML 转义
     */
    private escapeHtml(text: string): string {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * 销毁服务
     */
    destroy(): void {
        if (this.renderer) {
            this.renderer.destroy();
            this.renderer = null;
        }
    }
}

/**
 * LLM 对话打印服务
 * 
 * 扩展默认打印服务，添加对话专用的预处理逻辑
 */
export class LLMPrintService extends DefaultPrintService {
    /**
     * LLM 对话专用样式
     */
    private static readonly LLM_STYLES = `
        .mdx-print-message { page-break-inside: avoid; }
        .mdx-print-message + .mdx-print-message { margin-top: 12px; }
    `;

    /**
     * 重写渲染方法，添加对话结构转换
     */
    async renderForPrint(markdown: string, options: PrintOptions = {}): Promise<string> {
        // 预处理：将对话 Markdown 转换为带有 BEM 类名的结构
        const processedMarkdown = this.preprocessConversation(markdown);

        // 调用父类渲染
        return super.renderForPrint(processedMarkdown, {
            ...options,
            styles: [
                LLMPrintService.LLM_STYLES,
                ...(Array.isArray(options.styles) ? options.styles : options.styles ? [options.styles] : [])
            ],
        });
    }

    /**
     * 预处理对话 Markdown
     * 将角色标记转换为带有 BEM 类名的 HTML 结构
     */
    private preprocessConversation(markdown: string): string {
        const lines = markdown.split('\n');
        const result: string[] = [];
        let currentRole: 'user' | 'assistant' | 'system' | null = null;
        let messageBuffer: string[] = [];

        const flushMessage = () => {
            if (currentRole && messageBuffer.length > 0) {
                const content = messageBuffer.join('\n').trim();
                if (content) {
                    const avatarIcon = this.getRoleIcon(currentRole);
                    const roleLabel = this.getRoleLabel(currentRole);

                    result.push(`<div class="mdx-print-message mdx-print-message--${currentRole}">`);
                    result.push(`  <div class="mdx-print-message__header">`);
                    result.push(`    <span class="mdx-print-message__avatar">${avatarIcon}</span>`);
                    result.push(`    <span class="mdx-print-message__role">${roleLabel}</span>`);
                    result.push(`  </div>`);
                    result.push(`  <div class="mdx-print-message__content">\n\n${content}\n\n</div>`);
                    result.push(`</div>`);
                }
                messageBuffer = [];
            }
        };

        for (const line of lines) {
            // 检测角色标记
            const userMatch = line.match(/^##\s*User\s*$/i) || line.match(/^>\s*\*\*User\*\*/i);
            const assistantMatch = line.match(/^##\s*Assistant\s*$/i) || line.match(/^>\s*\*\*Assistant\*\*/i);
            const systemMatch = line.match(/^##\s*System\s*$/i) || line.match(/^>\s*\*\*System\*\*/i);
            const dividerMatch = line.match(/^---+$/);

            if (userMatch) {
                flushMessage();
                currentRole = 'user';
            } else if (assistantMatch) {
                flushMessage();
                currentRole = 'assistant';
            } else if (systemMatch) {
                flushMessage();
                currentRole = 'system';
            } else if (dividerMatch) {
                flushMessage();
                currentRole = null;
                result.push(`<div class="mdx-print-session">`);
                result.push(`  <div class="mdx-print-session__line"></div>`);
                result.push(`  <span class="mdx-print-session__label">New Session</span>`);
                result.push(`</div>`);
            } else if (currentRole) {
                messageBuffer.push(line);
            } else {
                result.push(line);
            }
        }

        flushMessage();
        return result.join('\n');
    }

    /**
     * 获取角色图标
     */
    private getRoleIcon(role: string): string {
        switch (role) {
            case 'user': return '👤';
            case 'assistant': return '🤖';
            case 'system': return '⚙️';
            default: return '💬';
        }
    }

    /**
     * 获取角色标签
     */
    private getRoleLabel(role: string): string {
        switch (role) {
            case 'user': return 'User';
            case 'assistant': return 'Assistant';
            case 'system': return 'System';
            default: return role;
        }
    }
}
