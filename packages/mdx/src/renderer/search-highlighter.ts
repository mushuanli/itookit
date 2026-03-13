// @mdx/renderer/search-highlighter.ts
import { RegexCache } from '../utils/regex-cache';

/**
 * 渲染器内搜索高亮
 * 从 MDxRenderer 中提取，符合 SRP
 */
export class SearchHighlighter {
    private markClass: string;
    private regexCache: RegexCache;

    constructor(markClass: string) {
        this.markClass = markClass;
        this.regexCache = new RegexCache(30);
    }

    /**
     * 搜索并高亮匹配文本
     * 使用 TreeWalker + DocumentFragment 批量处理
     */
    search(root: HTMLElement, query: string): HTMLElement[] {
        if (!query) return [];
        this.clear(root);

        const matches: HTMLElement[] = [];
        const regex = this.regexCache.get(query);

        // 收集文本节点
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        const nodesToProcess: Array<{
            node: Text;
            parent: Element;
            matches: RegExpMatchArray[];
        }> = [];

        let node: Node | null;
        while ((node = walker.nextNode())) {
            const textNode = node as Text;
            const text = textNode.textContent || '';
            const parent = textNode.parentElement;
            if (!parent) continue;

            regex.lastIndex = 0;
            const nodeMatches = Array.from(text.matchAll(regex));
            if (nodeMatches.length > 0) {
                nodesToProcess.push({ node: textNode, parent, matches: nodeMatches });
            }
        }

        // 批量替换
        for (const { node: textNode, parent, matches: nodeMatches } of nodesToProcess) {
            const text = textNode.textContent || '';
            const fragment = document.createDocumentFragment();
            let lastIndex = 0;

            for (const match of nodeMatches) {
                const matchIndex = match.index!;
                if (matchIndex > lastIndex) {
                    fragment.appendChild(document.createTextNode(text.substring(lastIndex, matchIndex)));
                }
                const mark = document.createElement('mark');
                mark.textContent = match[0];
                fragment.appendChild(mark);
                lastIndex = matchIndex + match[0].length;
            }

            if (lastIndex < text.length) {
                fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
            }

            const span = document.createElement('span');
            span.className = this.markClass;
            span.appendChild(fragment);
            parent.replaceChild(span, textNode);
            matches.push(span);
        }

        return matches;
    }

    gotoMatch(element: HTMLElement): void {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        element.classList.add(`${this.markClass}--active`);
    }

    clear(root: HTMLElement): void {
        const highlights = root.querySelectorAll(`.${this.markClass}`);
        if (highlights.length === 0) return;

        const parentsToNormalize = new Set<Element>();

        highlights.forEach(hl => {
            const parent = hl.parentElement;
            if (parent) {
                parentsToNormalize.add(parent);
                parent.replaceChild(document.createTextNode(hl.textContent || ''), hl);
            }
        });

        parentsToNormalize.forEach(p => p.normalize());
    }

    destroy(): void {
        this.regexCache.clear();
    }
}
