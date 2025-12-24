/**
 * @file mdx/plugins/interactions/clipboard.plugin.ts
 * @desc 处理富文本粘贴，自动转换 HTML 为 Markdown
 */

import { EditorView } from 'codemirror';
import type { MDxPlugin, PluginContext } from '../../core/plugin';

// 需要安装: npm install turndown turndown-plugin-gfm
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

export interface ClipboardPluginOptions {
    /** 是否启用 HTML 到 Markdown 转换 */
    enableHtmlToMarkdown?: boolean;
    /** 是否处理粘贴的图片 */
    enableImagePaste?: boolean;
    /** 自定义 Turndown 配置 */
    turndownOptions?: TurndownService.Options;
}

export class ClipboardPlugin implements MDxPlugin {
    name = 'interaction:clipboard';
    // 移除未使用的 context 字段，或添加下划线前缀表示有意不使用
    //private _context!: PluginContext;
    private options: Required<ClipboardPluginOptions>;
    private turndownService: TurndownService;

    constructor(options: ClipboardPluginOptions = {}) {
        this.options = {
            enableHtmlToMarkdown: options.enableHtmlToMarkdown ?? true,
            enableImagePaste: options.enableImagePaste ?? true,
            turndownOptions: options.turndownOptions ?? {},
        };

        // 初始化 Turndown 服务
        this.turndownService = new TurndownService({
            headingStyle: 'atx',
            codeBlockStyle: 'fenced',
            bulletListMarker: '-',
            ...this.options.turndownOptions,
        });

        // 使用 GFM 扩展（支持表格、删除线、任务列表等）
        this.turndownService.use(gfm);

        // 自定义图片处理规则
        this.turndownService.addRule('images', {
            filter: 'img',
            replacement: (_content: string, node: Node): string => {
                const img = node as HTMLImageElement;
                const alt = img.alt || '';
                const src = img.src || '';
                const title = img.title ? ` "${img.title}"` : '';
                
                // 标记外部图片，后续可以选择下载或保留原链接
                if (src.startsWith('data:')) {
                    // Base64 图片，标记为需要上传
                    return `![${alt}](${src})<!-- base64-image -->`;
                } else if (src.startsWith('http')) {
                    // 外部图片链接
                    return `![${alt}](${src}${title})`;
                }
                return `![${alt}](${src}${title})`;
            },
        });
    }

    install(context: PluginContext): void {
        //this._context = context;

        const extension = EditorView.domEventHandlers({
            paste: (event, view) => {
                return this.handlePaste(event, view);
            },
        });

        context.registerCodeMirrorExtension?.(extension);
    }

    private handlePaste(event: ClipboardEvent, view: EditorView): boolean {
        const clipboardData = event.clipboardData;
        if (!clipboardData) return false;

        // 优先级 1: 处理文件（图片等）
        if (this.options.enableImagePaste && clipboardData.files.length > 0) {
            // 检查是否有图片文件
            const imageFiles = Array.from(clipboardData.files).filter(f => 
                f.type.startsWith('image/')
            );
            
            if (imageFiles.length > 0) {
                // 让 UploadPlugin 处理
                return false;
            }
        }

        // 优先级 2: 处理 HTML 内容
        if (this.options.enableHtmlToMarkdown) {
            const htmlContent = clipboardData.getData('text/html');
            
            if (htmlContent && this.isRichContent(htmlContent)) {
                event.preventDefault();
                
                const markdown = this.convertHtmlToMarkdown(htmlContent);
                this.insertText(view, markdown);
                
                return true;
            }
        }

        // 优先级 3: 使用默认纯文本粘贴
        return false;
    }

    /**
     * 判断 HTML 是否为"有意义的"富文本
     * 过滤掉只包含纯文本的简单 HTML 包装
     */
    private isRichContent(html: string): boolean {
        // 创建临时 DOM 解析
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const body = doc.body;

        // 检查是否包含格式化标签
        const richTags = [
            'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
            'p', 'br',
            'strong', 'b', 'em', 'i', 'u', 's', 'del',
            'a', 'img',
            'ul', 'ol', 'li',
            'table', 'thead', 'tbody', 'tr', 'th', 'td',
            'pre', 'code', 'blockquote',
            'hr',
        ];

        for (const tag of richTags) {
            if (body.querySelector(tag)) {
                return true;
            }
        }

        // 检查是否有多个段落（换行）
        const textContent = body.textContent || '';
        const hasMultipleLines = textContent.includes('\n') || 
                                 body.querySelectorAll('div, span').length > 1;

        return hasMultipleLines;
    }

    /**
     * 将 HTML 转换为 Markdown
     */
    private convertHtmlToMarkdown(html: string): string {
        try {
            // 预处理：清理 HTML
            const cleanedHtml = this.preprocessHtml(html);
            
            // 使用 Turndown 转换
            let markdown = this.turndownService.turndown(cleanedHtml);
            
            // 后处理：清理 Markdown
            markdown = this.postprocessMarkdown(markdown);
            
            return markdown;
        } catch (error) {
            console.error('[ClipboardPlugin] HTML to Markdown conversion failed:', error);
            // 降级到纯文本
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            return doc.body.textContent || '';
        }
    }

    /**
     * 预处理 HTML
     */
    private preprocessHtml(html: string): string {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // 移除 script 和 style 标签
        doc.querySelectorAll('script, style, meta, link').forEach(el => el.remove());

        // 移除所有内联样式（可选）
        doc.querySelectorAll('[style]').forEach(el => el.removeAttribute('style'));

        // 处理特殊的复制源（如 Notion、Google Docs 等）
        // 可以根据需要添加特定处理逻辑

        return doc.body.innerHTML;
    }

    /**
     * 后处理 Markdown
     */
    private postprocessMarkdown(markdown: string): string {
        return markdown
            // 移除多余的空行
            .replace(/\n{3,}/g, '\n\n')
            // 移除行尾空格
            .replace(/[ \t]+$/gm, '')
            // 确保代码块前后有空行
            .replace(/([^\n])\n```/g, '$1\n\n```')
            .replace(/```\n([^\n])/g, '```\n\n$1')
            .trim();
    }

    /**
     * 插入文本到编辑器
     */
    private insertText(view: EditorView, text: string): void {
        const { from, to } = view.state.selection.main;
        
        view.dispatch({
            changes: { from, to, insert: text },
            selection: { anchor: from + text.length },
        });
    }

    destroy(): void {
        // 清理资源
    }
}
