/**
 * @file mdx/plugins/interactions/clipboard.plugin.ts
 * @desc 处理富文本粘贴，自动转换 HTML 为 Markdown
 */

import { EditorView } from 'codemirror';
import type { MDxPlugin, PluginContext } from '../../core/types';

// 需要安装: npm install turndown turndown-plugin-gfm
/// <reference path="../../types/turndown-plugin-gfm.d.ts" />
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

export type ClipboardPasteMode = 'smart' | 'plain' | 'rich';

export interface ClipboardPluginOptions {
    /** 是否启用 HTML 到 Markdown 转换 */
    enableHtmlToMarkdown?: boolean;
    /** 是否处理粘贴的图片 */
    enableImagePaste?: boolean;
    /**
     * 默认粘贴模式：
     * - smart: 仅将具有明确富文本语义的 HTML 转为 Markdown
     * - plain: 始终使用 text/plain
     * - rich: 只要存在 HTML 就转为 Markdown
     * @default 'smart'
     */
    pasteMode?: ClipboardPasteMode;
    /** 是否启用 Cmd/Ctrl+Shift+V 原始粘贴 */
    enablePlainPasteShortcut?: boolean;
    /** 自定义 Turndown 配置 */
    turndownOptions?: TurndownService.Options;
}

export class ClipboardPlugin implements MDxPlugin {
    name = 'interaction:clipboard';
    // 移除未使用的 context 字段，或添加下划线前缀表示有意不使用
    //private _context!: PluginContext;
    private options: Required<ClipboardPluginOptions>;
    private turndownService: TurndownService;
    private plainPasteRequestedAt = 0;

    constructor(options: ClipboardPluginOptions = {}) {
        this.options = {
            enableHtmlToMarkdown: options.enableHtmlToMarkdown ?? true,
            enableImagePaste: options.enableImagePaste ?? true,
            pasteMode: options.pasteMode ?? 'smart',
            enablePlainPasteShortcut: options.enablePlainPasteShortcut ?? true,
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
            keydown: (event) => {
                if (this.isPlainPasteShortcut(event)) {
                    // paste 事件本身不包含可靠的组合键信息，因此在 keydown
                    // 记录一次性意图，并让浏览器继续执行原生 paste。
                    this.plainPasteRequestedAt = Date.now();
                }
                return false;
            },
            paste: (event, view) => {
                return this.handlePaste(event, view);
            },
        });

        context.registerCodeMirrorExtension?.(extension);
    }

    private handlePaste(event: ClipboardEvent, view: EditorView): boolean {
        const clipboardData = event.clipboardData;
        if (!clipboardData) return false;

        const forcePlain = this.consumePlainPasteRequest();

        // 优先级 1: 处理文件（图片等）
        if (this.options.enableImagePaste) {
            const allFiles = clipboardData.files.length > 0
                ? Array.from(clipboardData.files)
                : Array.from(clipboardData.items)
                    .filter(item => item.kind === 'file')
                    .map(item => item.getAsFile())
                    .filter((f): f is File => f !== null);

            const imageFiles = allFiles.filter(f => f.type.startsWith('image/'));
            if (imageFiles.length > 0) {
                // 让 UploadPlugin 处理
                return false;
            }
        }

        // 优先级 2: 原始粘贴。返回 false，由 CodeMirror 使用 text/plain
        // 完成原生粘贴，可同时保留多光标等默认行为。
        if (forcePlain || !this.options.enableHtmlToMarkdown || this.options.pasteMode === 'plain') {
            return false;
        }

        // 优先级 3: 剪贴板明确声明为 Markdown 时直接插入，不经过 Turndown。
        if (this.options.pasteMode === 'smart') {
            const markdownContent = clipboardData.getData('text/markdown') ||
                clipboardData.getData('application/x-itookit-markdown');
            if (markdownContent) {
                event.preventDefault();
                this.insertText(view, markdownContent);
                return true;
            }
        }

        // 优先级 4: 富文本转换。
        const htmlContent = clipboardData.getData('text/html');
        if (htmlContent && (
            this.options.pasteMode === 'rich' || this.hasSemanticRichContent(htmlContent)
        )) {
            event.preventDefault();

            const markdown = this.convertHtmlToMarkdown(htmlContent);
            this.insertText(view, markdown);

            return true;
        }

        // 优先级 5: 使用默认纯文本粘贴
        return false;
    }

    private isPlainPasteShortcut(event: KeyboardEvent): boolean {
        return this.options.enablePlainPasteShortcut &&
            event.key.toLowerCase() === 'v' &&
            event.shiftKey &&
            (event.metaKey || event.ctrlKey);
    }

    private consumePlainPasteRequest(): boolean {
        const requestedAt = this.plainPasteRequestedAt;
        this.plainPasteRequestedAt = 0;

        // 避免快捷键未触发 paste 时影响之后通过菜单发起的粘贴。
        return requestedAt > 0 && Date.now() - requestedAt < 1000;
    }

    /**
     * 判断 HTML 是否为"有意义的"富文本
     * 过滤掉只包含纯文本的简单 HTML 包装
     */
    private hasSemanticRichContent(html: string): boolean {
        // 创建临时 DOM 解析
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const body = doc.body;

        // 只检查会改变 Markdown 语义的标签。p/div/span/br 等普通包装
        // 直接使用 text/plain，避免把 Markdown 源码再次转义。
        const richTags = [
            'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
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

        return false;
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
        view.dispatch({
            ...view.state.replaceSelection(text),
            userEvent: 'input.paste',
            scrollIntoView: true,
        });
    }

    destroy(): void {
        // 清理资源
    }
}
