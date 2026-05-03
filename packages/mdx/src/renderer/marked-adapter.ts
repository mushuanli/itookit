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
        markedOptions?: any
    ): Promise<string> {
        const marked = new Marked();
        this.configure(marked, extensions, markedOptions);
        return await marked.parse(markdown);
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
