/**
 * @file mdx/plugins/interactions/clipboard.plugin.ts
 * @desc 处理富文本粘贴：默认原样粘贴，仅在确认为富文本时转换为 Markdown
 */

import { EditorView } from 'codemirror';
import type { MDxPlugin, PluginContext } from '../../core/types';

// 需要安装: npm install turndown turndown-plugin-gfm
/// <reference path="../../types/turndown-plugin-gfm.d.ts" />
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

export type ClipboardPasteMode = 'smart' | 'plain' | 'rich';

/** 一次粘贴的某种表示，用于在内联提示条上与另一种表示互相切换 */
interface PasteVariant {
    /** 该表示对应的文本 */
    text: string;
    /** 描述「当前已插入内容」的文案 */
    message: string;
    /** 切换到另一种表示的按钮文案 */
    actionLabel: string;
}

/** 已插入内容与其替代表示，提示条据此原位切换 */
interface PasteSwap {
    view: EditorView;
    from: number;
    to: number;
    current: PasteVariant;
    alternative: PasteVariant;
}

export interface ClipboardPluginOptions {
    /** 是否启用 HTML 到 Markdown 转换 */
    enableHtmlToMarkdown?: boolean;
    /** 是否处理粘贴的图片 */
    enableImagePaste?: boolean;
    /**
     * 默认粘贴模式：
     * - smart: 富文本转 Markdown，但纯文本已是 Markdown 源码时原样粘贴
     * - plain: 始终使用 text/plain
     * - rich: 只要存在 HTML 就转为 Markdown
     * @default 'smart'
     */
    pasteMode?: ClipboardPasteMode;
    /** 是否启用 Cmd/Ctrl+Shift+V 原始粘贴 */
    enablePlainPasteShortcut?: boolean;
    /**
     * 是否在富文本粘贴后显示内联提示条，
     * 供用户在「原文」与「Markdown」之间一键切换。
     * @default true
     */
    enablePasteHint?: boolean;
    /** 自定义 Turndown 配置 */
    turndownOptions?: TurndownService.Options;
}

/** 原生粘贴后探测插入范围的帧数上限（约 200ms） */
const NATIVE_PROBE_FRAMES = 12;

/**
 * 判定「纯文本本身已是 Markdown」的结构信号。
 * 普通 `- ` 列表与有序列表过于含糊（散文里也会出现），不参与判定。
 */
const MARKDOWN_SIGNALS: readonly RegExp[] = [
    /^ {0,3}(?:```|~~~)/m,                        // 围栏代码块
    /^ {0,3}#{1,6}[ \t]+\S/m,                     // ATX 标题
    /^ {0,3}>[ \t]?/m,                            // 引用
    /^ {0,3}[-*+][ \t]+\[[ xX]\][ \t]/m,          // 任务列表
    /!?\[[^\]\n]*\]\([^)\n]*\)/,                  // 链接 / 图片
    /^ {0,3}\|.*\|[ \t]*$/m,                      // 表格行
    /`[^`\n]+`/,                                  // 行内代码
    /\*\*[^*\n]+\*\*|__[^_\n]+__/,                // 粗体
    /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/m,     // 分割线
];

export class ClipboardPlugin implements MDxPlugin {
    name = 'interaction:clipboard';
    private options: Required<ClipboardPluginOptions>;
    private turndownService: TurndownService;
    private plainPasteRequestedAt = 0;
    private swap: PasteSwap | null = null;
    private hintElement: HTMLElement | null = null;
    private hintDismissFns: Array<() => void> = [];
    private repositionScheduled = false;
    /** 每次处理粘贴都会自增，用于让过期的原生粘贴探测失效 */
    private pasteToken = 0;

    constructor(options: ClipboardPluginOptions = {}) {
        this.options = {
            enableHtmlToMarkdown: options.enableHtmlToMarkdown ?? true,
            enableImagePaste: options.enableImagePaste ?? true,
            pasteMode: options.pasteMode ?? 'smart',
            enablePlainPasteShortcut: options.enablePlainPasteShortcut ?? true,
            enablePasteHint: options.enablePasteHint ?? true,
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

        this.clearHint();
        const forcePlain = this.consumePlainPasteRequest();

        // 优先级 1: 处理文件（图片等），交给 UploadPlugin
        if (this.options.enableImagePaste && this.hasImageFiles(clipboardData)) {
            return false;
        }

        // 优先级 2: 原始粘贴。返回 false，由 CodeMirror 使用 text/plain
        // 完成原生粘贴，可同时保留多光标等默认行为。
        if (forcePlain || !this.options.enableHtmlToMarkdown || this.options.pasteMode === 'plain') {
            return false;
        }

        // 优先级 3: 剪贴板明确声明为 Markdown 时直接插入，不经过 Turndown。
        if (this.options.pasteMode === 'smart') {
            const declared = this.readDeclaredMarkdown(clipboardData);
            if (declared) {
                event.preventDefault();
                this.insertText(view, declared, null);
                return true;
            }
        }

        return this.handleHtmlPaste(event, view, clipboardData);
    }

    /**
     * 依据 text/html 决策：原样粘贴（并提示可转换），还是直接转换为 Markdown。
     */
    private handleHtmlPaste(event: ClipboardEvent, view: EditorView, clipboardData: DataTransfer): boolean {
        const html = clipboardData.getData('text/html');
        if (!html) return false;

        const plainText = clipboardData.getData('text/plain');
        const convertible = this.options.pasteMode === 'rich' || this.hasSemanticRichContent(html);
        if (!convertible) return false;

        // smart 模式：纯文本本身就是 Markdown 源码时原样粘贴，
        // 避免 Turndown 把 `#`/`[`/`*` 等字符转义。
        if (this.options.pasteMode === 'smart' &&
            this.looksLikeMarkdown(plainText) &&
            !this.isPredominantlyCode(html)) {
            this.hintAfterNativePaste(view, plainText, html);
            return false;
        }

        event.preventDefault();
        this.insertConverted(view, plainText, html);
        return true;
    }

    /** 插入转换结果，并保留原文以便在提示条上切回 */
    private insertConverted(view: EditorView, plainText: string, html: string): void {
        const markdown = this.convertHtmlToMarkdown(html);
        const swap = this.options.enablePasteHint && markdown.trim() !== plainText.trim()
            ? {
                current: this.markdownVariant(markdown),
                alternative: this.plainVariant(plainText),
            }
            : null;

        this.insertText(view, markdown, swap);
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

    private hasImageFiles(clipboardData: DataTransfer): boolean {
        const files = clipboardData.files.length > 0
            ? Array.from(clipboardData.files)
            : Array.from(clipboardData.items)
                .filter(item => item.kind === 'file')
                .map(item => item.getAsFile())
                .filter((file): file is File => file !== null);

        return files.some(file => file.type.startsWith('image/'));
    }

    private readDeclaredMarkdown(clipboardData: DataTransfer): string {
        return clipboardData.getData('text/markdown') ||
            clipboardData.getData('application/x-itookit-markdown');
    }

    /**
     * 判断 HTML 是否为「有意义的」富文本
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
     * 纯文本是否已含有 Markdown 结构信号。
     * 命中即认为用户手里拿的就是 Markdown 源码，应原样粘贴。
     */
    private looksLikeMarkdown(text: string): boolean {
        if (!text) return false;
        return MARKDOWN_SIGNALS.some(pattern => pattern.test(text));
    }

    /**
     * HTML 的文本主体是否为代码块。
     * 从网页复制代码时，代码里的 `#` 注释等会命中 Markdown 信号，
     * 但此时转换为围栏代码块才是正确结果。
     */
    private isPredominantlyCode(html: string): boolean {
        const parser = new DOMParser();
        const body = parser.parseFromString(html, 'text/html').body;
        const totalLength = countNonSpace(body.textContent || '');
        if (totalLength === 0) return false;

        const blocks = body.querySelector('pre')
            ? body.querySelectorAll('pre')
            : body.querySelectorAll('code');

        let codeLength = 0;
        blocks.forEach(el => { codeLength += countNonSpace(el.textContent || ''); });

        return codeLength / totalLength >= 0.8;
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
     * 后处理 Markdown。
     * 清理只作用于围栏代码块之外的散文：代码块内部必须逐字保留
     * （空行、行尾空格都是内容的一部分，Turndown 已在围栏外补好空行）。
     */
    private postprocessMarkdown(markdown: string): string {
        return markdown
            .split(/(^ {0,3}(?:```|~~~)[\s\S]*?^ {0,3}(?:```|~~~)[ \t]*$)/m)
            .map((segment, index) => index % 2 === 1 ? segment : this.cleanProse(segment))
            .join('')
            .trim();
    }

    /** 移除多余的连续空行与行尾空格 */
    private cleanProse(text: string): string {
        return text
            .replace(/\n{3,}/g, '\n\n')
            .replace(/[ \t]+$/gm, '');
    }

    /**
     * 插入文本到编辑器；提供 swap 时记录插入范围，用于提示条原位切换。
     */
    private insertText(
        view: EditorView,
        text: string,
        swap: Omit<PasteSwap, 'view' | 'from' | 'to'> | null,
    ): void {
        view.dispatch({
            ...view.state.replaceSelection(text),
            userEvent: 'input.paste',
            scrollIntoView: true,
        });

        if (!swap) return;

        const to = view.state.selection.main.head;
        const from = to - text.length;
        if (from < 0 || view.state.doc.sliceString(from, to) !== text) return;

        this.showHint({ view, from, to, ...swap });
    }

    /**
     * 原生粘贴（返回 false 让浏览器完成）后，探测实际插入范围并给出提示条。
     * CodeMirror 通过 DOM 观察异步同步内容，因此需要有限次重试。
     */
    private hintAfterNativePaste(view: EditorView, plainText: string, html: string): void {
        if (!this.options.enablePasteHint) return;

        const token = ++this.pasteToken;
        const inserted = plainText.replace(/\r\n?/g, '\n');
        let attempts = 0;

        const probe = () => {
            if (token !== this.pasteToken) return;

            const to = view.state.selection.main.head;
            const from = to - inserted.length;
            if (from < 0 || view.state.doc.sliceString(from, to) !== inserted) {
                if (++attempts < NATIVE_PROBE_FRAMES) nextFrame(probe);
                return;
            }

            const markdown = this.convertHtmlToMarkdown(html);
            if (markdown.trim() === inserted.trim()) return;

            this.showHint({
                view,
                from,
                to,
                current: this.plainVariant(inserted),
                alternative: this.markdownVariant(markdown),
            });
        };

        nextFrame(probe);
    }

    private plainVariant(text: string): PasteVariant {
        return { text, message: '已按原文粘贴', actionLabel: '转为 Markdown' };
    }

    private markdownVariant(text: string): PasteVariant {
        return { text, message: '已转换为 Markdown', actionLabel: '保持原文' };
    }

    private showHint(swap: PasteSwap): void {
        this.swap = swap;
        this.renderHint(swap);
    }

    private renderHint(swap: PasteSwap): void {
        const element = this.ensureHintElement(swap.view.dom.ownerDocument);
        this.unbindHintTracking();

        const message = element.querySelector<HTMLElement>('.mdx-paste-hint__message');
        const action = element.querySelector<HTMLButtonElement>('.mdx-paste-hint__action');
        if (message) message.textContent = swap.current.message;
        if (action) action.textContent = swap.current.actionLabel;

        // 先显示再定位：定位只是锦上添花，任何定位失败都不能让提示条不可见。
        element.classList.add('mdx-paste-hint--visible');
        this.positionHint(element, swap);
        this.bindHintTracking(swap.view);
    }

    private ensureHintElement(doc: Document): HTMLElement {
        if (this.hintElement) return this.hintElement;

        const element = doc.createElement('div');
        element.className = 'mdx-paste-hint';
        element.setAttribute('role', 'status');
        element.innerHTML = `
            <span class="mdx-paste-hint__message"></span>
            <button class="mdx-paste-hint__action" type="button"></button>
            <button class="mdx-paste-hint__close" type="button" aria-label="关闭">×</button>
        `;

        element.querySelector('.mdx-paste-hint__action')
            ?.addEventListener('click', () => this.applyAlternative());
        element.querySelector('.mdx-paste-hint__close')
            ?.addEventListener('click', () => this.clearHint());

        doc.body.appendChild(element);
        this.hintElement = element;
        return element;
    }

    /** 在另一种表示之间原位切换，并把提示条反向更新 */
    private applyAlternative(): void {
        const swap = this.swap;
        if (!swap) return;

        const { view, from, to } = swap;
        const text = swap.alternative.text;
        // 编辑器可能已被销毁，或插入内容已被用户改动
        if (!view.dom.isConnected || to > view.state.doc.length ||
            view.state.doc.sliceString(from, to) !== swap.current.text) {
            this.clearHint();
            return;
        }

        view.dispatch({
            changes: { from, to, insert: text },
            selection: { anchor: from + text.length },
            userEvent: 'input.paste',
            scrollIntoView: true,
        });

        this.showHint({
            view,
            from,
            to: from + text.length,
            current: swap.alternative,
            alternative: swap.current,
        });
    }

    /**
     * 提示条定位：优先贴光标，失败（视图不可测量、位置在可视区外等）
     * 时退化为视口底部居中，**绝不允许抛异常**。
     */
    private positionHint(element: HTMLElement, swap: PasteSwap): void {
        const margin = 8;
        const rect = element.getBoundingClientRect();
        const fallback = {
            left: Math.max(margin, (window.innerWidth - rect.width) / 2),
            top: window.innerHeight - rect.height - 24,
        };

        let target = fallback;
        try {
            const coords = swap.view.coordsAtPos(swap.to) ?? swap.view.coordsAtPos(swap.from);
            if (coords) target = { left: coords.left, top: coords.bottom + 6 };
        } catch {
            target = fallback;
        }

        const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
        const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
        element.style.left = `${Math.min(Math.max(margin, target.left), maxLeft)}px`;
        element.style.top = `${Math.min(Math.max(margin, target.top), maxTop)}px`;
    }

    /**
     * 提示条跟随滚动重新定位（而不是隐藏），
     * 并在用户开始编辑时收起——长文档滚动后按钮依然拿得到。
     */
    private bindHintTracking(view: EditorView): void {
        const reposition = () => this.scheduleReposition();
        const hide = () => this.clearHint();

        window.addEventListener('resize', reposition);
        view.scrollDOM.addEventListener('scroll', reposition, { passive: true });
        view.dom.addEventListener('keydown', hide);
        view.dom.addEventListener('mousedown', hide);

        this.hintDismissFns.push(() => {
            window.removeEventListener('resize', reposition);
            view.scrollDOM.removeEventListener('scroll', reposition);
            view.dom.removeEventListener('keydown', hide);
            view.dom.removeEventListener('mousedown', hide);
        });
    }

    private scheduleReposition(): void {
        if (this.repositionScheduled) return;
        this.repositionScheduled = true;
        nextFrame(() => {
            this.repositionScheduled = false;
            if (this.hintElement && this.swap) this.positionHint(this.hintElement, this.swap);
        });
    }

    private unbindHintTracking(): void {
        this.hintDismissFns.forEach(fn => fn());
        this.hintDismissFns = [];
    }

    private clearHint(): void {
        this.pasteToken++;
        this.swap = null;
        this.unbindHintTracking();
        this.hintElement?.classList.remove('mdx-paste-hint--visible');
    }

    destroy(): void {
        this.clearHint();
        this.hintElement?.remove();
        this.hintElement = null;
    }
}

function countNonSpace(text: string): number {
    return text.replace(/\s+/g, '').length;
}

/** 无 rAF 的环境（jsdom / 测试）退化为 setTimeout，避免打断粘贴流程 */
function nextFrame(cb: () => void): void {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(cb);
    else setTimeout(cb, 16);
}
