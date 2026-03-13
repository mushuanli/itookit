// @mdx/editor/search-manager.ts
import { UnifiedSearchResult } from '@itookit/common';
import { CodeMirrorAdapter } from './codemirror-adapter';
import { RegexCache } from '../utils/regex-cache';
import type { MDxRenderer } from '../renderer/mdx-renderer';

/**
 * 搜索管理器
 * 职责：统一编辑器/渲染器搜索逻辑
 * 消除 MDxEditor 和 MDxRenderer 中重复的正则缓存
 */
export class SearchManager {
    private cmAdapter: CodeMirrorAdapter;
    private renderer: MDxRenderer;
    private regexCache: RegexCache;

    constructor(cmAdapter: CodeMirrorAdapter, renderer: MDxRenderer) {
        this.cmAdapter = cmAdapter;
        this.renderer = renderer;
        this.regexCache = new RegexCache(50);
    }

    search(query: string, mode: 'edit' | 'render'): UnifiedSearchResult[] {
        this.clearSearch(mode);
        if (!query) return [];

        return mode === 'edit'
            ? this.searchInEditor(query)
            : this.searchInRenderer(query);
    }

    private searchInEditor(query: string): UnifiedSearchResult[] {
        this.cmAdapter.enableSearch();
        const view = this.cmAdapter.getRawView();
        if (!view) return [];

        const results: UnifiedSearchResult[] = [];
        const docString = view.state.doc.toString();
        const regex = this.regexCache.get(query);

        let match: RegExpExecArray | null;
        while ((match = regex.exec(docString)) !== null) {
            results.push({
                source: 'editor',
                text: match[0],
                context: view.state.doc.lineAt(match.index).text,
                details: { from: match.index, to: match.index + match[0].length },
            });
        }
        return results;
    }

    private searchInRenderer(query: string): UnifiedSearchResult[] {
        const matches = this.renderer.search(query);
        return matches.map(el => ({
            source: 'renderer',
            text: el.textContent || '',
            context: el.parentElement?.textContent?.substring(0, 100) || '',
            details: { element: el },
        }));
    }

    gotoMatch(result: UnifiedSearchResult): void {
        if (result.source === 'editor') {
            const view = this.cmAdapter.getRawView();
            if (view && result.details.from !== undefined) {
                view.dispatch({
                    selection: { anchor: result.details.from, head: result.details.to },
                    scrollIntoView: true,
                });
                view.focus();
            }
        } else if (result.details.element) {
            this.renderer.gotoMatch(result.details.element);
        }
    }

    clearSearch(mode: 'edit' | 'render'): void {
        if (mode === 'edit') this.cmAdapter.disableSearch();
        else this.renderer.clearSearch();
    }

    destroy(): void {
        this.regexCache.clear();
    }
}
