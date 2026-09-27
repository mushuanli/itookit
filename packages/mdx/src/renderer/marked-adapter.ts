import { lexInWorker, needsWorker } from './worker-lexer';
import { workerSyntax } from './worker-tokenizers';
// @mdx/renderer/marked-adapter.ts
import { Marked, Tokens } from 'marked';
import { slugify } from '@itookit/common';

/**
 * Marked 适配器
 * 职责：封装 marked 库的所有直接依赖
 * 好处：marked 版本升级只影响此文件
 */
export class MarkedAdapter {
    /**
     * 解析 Markdown 为 HTML
     */
    async parse(
        markdown: string,
        extensions: any[],
        markedOptions?: any,
        signal?: AbortSignal
    ): Promise<string> {
        const marked = new Marked();
        this.configure(marked, extensions, markedOptions);
        signal?.throwIfAborted();
        if (needsWorker(markdown)) {
            const syntax = workerSyntax([...extensions, markedOptions ?? {}]);
            const options = { gfm: marked.defaults.gfm ?? true, breaks: marked.defaults.breaks ?? true,
                pedantic: marked.defaults.pedantic ?? false };
            marked.use({ async: true, hooks: { provideLexer: (() =>
                (text: string) => lexInWorker(text, syntax, options, signal)) as any } });
        }
        const html = await marked.parse(markdown);
        signal?.throwIfAborted();
        return html;
    }

    private configure(marked: Marked, extensions: any[], markedOptions?: any): void {
        // 标题渲染器：生成带 ID 的标题
        const renderer = {
            heading(token: Tokens.Heading): string {
                const text = token.text;
                const level = token.depth;
                const cleanText = text.replace(/<[^>]*>/g, '');
                const id = `heading-${slugify(cleanText)}`;
                return `<h${level} id="${id}">${text}</h${level}>`;
            }
        };

        marked.use({ renderer, breaks: true });

        if (extensions.length > 0) {
            marked.use(...extensions);
        }

        if (markedOptions) {
            marked.use(markedOptions);
        }
    }
}
