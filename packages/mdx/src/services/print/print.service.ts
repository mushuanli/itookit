// @file: mdx/core/print.service.ts

import { MDxRenderer } from '../../renderer/mdx-renderer';
import type { IModuleFS } from '@itookit/common';

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

    /** 正文字体大小 */
    fontSize?: 'small' | 'normal' | 'large';
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
    private sessionEngine?: IModuleFS;
    private nodeId?: string;

    constructor(sessionEngine?: IModuleFS, nodeId?: string) {
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

        // 添加字体大小覆盖
        if (options.fontSize) {
            const sizeMap: Record<string, string> = {
                small: '12px',
                normal: '14px',
                large: '16px',
            };
            const baseSize = sizeMap[options.fontSize] || '14px';
            styles += `\n.mdx-print { font-size: ${baseSize}; }`;
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
     * 解析打印选项：fontSize 未显式设置时弹出选择对话框
     */
    private async resolvePrintOptions(options: PrintOptions): Promise<PrintOptions> {
        if (options.fontSize) {
            return options;
        }
        const fontSize = await this.showPrintOptionsDialog();
        return { ...options, fontSize };
    }

    /**
     * 弹出打印选项对话框，返回用户选择的字体大小
     */
    private showPrintOptionsDialog(): Promise<'small' | 'normal' | 'large'> {
        return new Promise((resolve) => {
            const overlay = document.createElement('div');
            overlay.style.cssText =
                'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.4);';

            const options: Array<{ value: 'small' | 'normal' | 'large'; label: string; desc: string }> = [
                { value: 'small', label: '小', desc: '12px' },
                { value: 'normal', label: '中', desc: '14px' },
                { value: 'large', label: '大', desc: '16px' },
            ];

            const buttons = options.map(o =>
                `<button data-size="${o.value}"
                    style="flex:1;padding:12px 20px;border:2px solid #d0d5dd;border-radius:8px;background:#fff;cursor:pointer;font-size:14px;transition:border-color .2s;">
                    <div style="font-weight:600;margin-bottom:4px;">${o.label}</div>
                    <div style="color:#656d76;font-size:12px;">${o.desc}</div>
                </button>`
            ).join('');

            overlay.innerHTML = `
                <div style="background:#fff;border-radius:12px;padding:24px;min-width:320px;box-shadow:0 8px 32px rgba(0,0,0,0.2);">
                    <div style="font-size:16px;font-weight:600;margin-bottom:16px;">打印字体大小</div>
                    <div style="display:flex;gap:12px;margin-bottom:16px;">${buttons}</div>
                    <div style="display:flex;justify-content:flex-end;gap:8px;">
                        <button id="mdx-print-cancel"
                            style="padding:8px 16px;border:1px solid #d0d5dd;border-radius:6px;background:#fff;cursor:pointer;font-size:13px;">取消</button>
                    </div>
                </div>`;

            document.body.appendChild(overlay);

            const cleanup = (value?: 'small' | 'normal' | 'large') => {
                document.body.removeChild(overlay);
                resolve(value || 'normal');
            };

            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) cleanup('normal');
            });

            overlay.querySelector('#mdx-print-cancel')!.addEventListener('click', () => cleanup('normal'));

            overlay.querySelectorAll<HTMLButtonElement>('[data-size]').forEach(btn => {
                btn.addEventListener('click', () => cleanup(btn.dataset.size as 'small' | 'normal' | 'large'));
                btn.addEventListener('mouseenter', () => { btn.style.borderColor = '#4f46e5'; });
                btn.addEventListener('mouseleave', () => { btn.style.borderColor = '#d0d5dd'; });
            });
        });
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
        const resolved = await this.resolvePrintOptions(options);
        const contentHtml = await this.renderForPrint(markdown, resolved);
        await this.printFromHtml(contentHtml, resolved);
    }

    /**
     * ✅ [新增] 直接使用 HTML 内容打印
     */
    async printFromHtml(contentHtml: string, options: PrintOptions = {}): Promise<void> {
        const resolved = await this.resolvePrintOptions(options);
        //const title = resolved.title || 'Print';
        const styles = this.getStyles(resolved);
        const header = this.buildHeader(resolved);

        // 确定变体类名
        const variantClass = resolved.variant === 'compact' ? 'mdx-print--compact' : '';
        const headerClass = resolved.showHeader === false ? 'mdx-print--no-header' : '';

        // 在主文档中创建打印容器，通过 @media print 隔离
        const containerId = 'mdx-print-overlay';
        let container = document.getElementById(containerId);
        if (!container) {
            container = document.createElement('div');
            container.id = containerId;
            document.body.appendChild(container);
        }

        // 注入打印专用样式：打印时仅显示此容器，并附加打印内容样式
        const styleId = 'mdx-print-overlay-style';
        let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = styleId;
            document.head.appendChild(styleEl);
        }
        styleEl.textContent = `
            #${containerId} { display: none; }
            @media print {
                html, body {
                    overflow: visible !important;
                    height: auto !important;
                    position: static !important;
                }
                body > *:not(#${containerId}) { display: none !important; }
                #${containerId} {
                    display: block !important;
                    position: static !important;
                    width: auto !important;
                    overflow: visible !important;
                    height: auto !important;
                }
            }
            ${styles}
        `;

        // 打印前预处理：展开所有折叠内容
        contentHtml = this.preprocessHtmlForPrint(contentHtml);

        // 只填充 body 内容（不包含完整的 HTML 文档结构，避免 innerHTML 剥离标签）
        container.innerHTML = `
            <article class="mdx-print ${variantClass} ${headerClass}">
                ${header}
                <main class="mdx-print-content">
                    ${contentHtml}
                </main>
            </article>
        `;

        // 等待渲染完成（图片等资源）
        await new Promise(resolve => setTimeout(resolve, 300));

        window.print();

        // 打印后清理
        this.cleanupAfterPrint(container, styleEl);
    }

    /**
     * 打印前预处理：展开所有折叠内容
     * - 确保所有 <details> 带 open 属性（CSS 不足以可靠展开）
     */
    private preprocessHtmlForPrint(html: string): string {
        // 确保所有 <details> 带 open 属性
        return html.replace(
            /<details(?![^>]*\bopen\b)([^>]*)>/g,
            '<details open$1>'
        );
    }

    /**
     * 打印后清理容器和样式
     */
    private cleanupAfterPrint(container: HTMLElement, styleEl: HTMLStyleElement): void {
        let cleaned = false;

        const cleanup = () => {
            if (cleaned) return;
            cleaned = true;
            window.removeEventListener('afterprint', cleanup);
            window.removeEventListener('focus', cleanup);
            if (container.parentNode) {
                container.innerHTML = '';
            }
            if (styleEl.parentNode) {
                document.head.removeChild(styleEl);
            }
        };

        window.addEventListener('afterprint', cleanup, { once: true });
        // 兜底：打印对话框关闭后主窗口重新获得焦点
        window.addEventListener('focus', cleanup, { once: true });
        // 最终兜底：60 秒后强制清理
        setTimeout(cleanup, 60000);
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
