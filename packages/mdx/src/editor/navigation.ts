// @mdx/editor/navigation.ts
import { extractHeadings, slugify, tryParseJson, type Heading } from '@itookit/common';
import { CodeMirrorAdapter } from './codemirror-adapter';

interface HeadingPosition {
    from: number;
    to: number;
    level: number;
    text: string;
}

/**
 * 导航管理器
 * 职责：标题解析缓存 + 编辑器/渲染器内导航 + 高亮生命周期
 */
export class NavigationManager {
    private cmAdapter: CodeMirrorAdapter;
    private headingsCache: { version: number; headings: Heading[] } | null = null;
    private positionsCache: { version: number; positions: Map<string, HeadingPosition> } | null = null;
    private highlightTimer: number | null = null;

    constructor(cmAdapter: CodeMirrorAdapter) {
        this.cmAdapter = cmAdapter;
    }

    // === 标题解析（带版本缓存） ===

    getHeadings(text: string, docVersion: number): Heading[] {
        if (this.headingsCache?.version === docVersion) {
            return this.headingsCache.headings;
        }
        if (tryParseJson(text)) {
            this.headingsCache = { version: docVersion, headings: [] };
            return [];
        }
        const headings = extractHeadings(text, { nested: false });
        this.headingsCache = { version: docVersion, headings };
        return headings;
    }

    /**
     * 获取标题在源码中的位置映射（带缓存）
     */
    private getPositions(text: string, docVersion: number): Map<string, HeadingPosition> {
        if (this.positionsCache?.version === docVersion) {
            return this.positionsCache.positions;
        }

        const positions = new Map<string, HeadingPosition>();

        if (tryParseJson(text)) {
            this.positionsCache = { version: docVersion, positions };
            return positions;
        }

        // 移除代码块后解析标题
        const cleaned = text.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, '');
        const regex = /^(#{1,6})\s+(.+)$/gm;
        const slugCounts = new Map<string, number>();

        let match: RegExpExecArray | null;
        while ((match = regex.exec(cleaned)) !== null) {
            const headingText = match[2].trim();
            const baseSlug = slugify(headingText);
            const count = slugCounts.get(baseSlug) || 0;
            slugCounts.set(baseSlug, count + 1);

            const finalSlug = count === 0 ? baseSlug : `${baseSlug}-${count}`;
            positions.set(`heading-${finalSlug}`, {
                from: match.index,
                to: match.index + match[0].length,
                level: match[1].length,
                text: headingText,
            });
        }

        this.positionsCache = { version: docVersion, positions };
        return positions;
    }

    // === 渲染器内导航 ===

    async navigateInRenderer(container: HTMLElement, elementId: string, smooth: boolean): Promise<void> {
        try {
            const element = container.querySelector(`#${CSS.escape(elementId)}`);
            if (!element) {
                console.warn(`[Navigation] Element not found: #${elementId}`);
                return;
            }
            element.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant', block: 'center' });
            element.classList.add('highlight-pulse');
            setTimeout(() => element.classList.remove('highlight-pulse'), 1500);
        } catch (e) {
            console.error('[Navigation] Renderer navigation error:', e);
        }
    }

    // === 编辑器内导航 ===

    async navigateInEditor(
        elementId: string,
        text: string,
        docVersion: number,
        isDestroying: boolean
    ): Promise<void> {
        const positions = this.getPositions(text, docVersion);
        let position = positions.get(elementId);

        // 模糊匹配回退
        if (!position) {
            const baseId = elementId.replace(/-\d+$/, '');
            for (const [id, pos] of positions) {
                if (id === baseId || id.startsWith(baseId + '-')) {
                    position = pos;
                    break;
                }
            }
        }

        if (!position) {
            console.warn(`[Navigation] Heading not found: ${elementId}`);
            return;
        }

        const { from, to } = position;

        // 清理旧高亮
        this.clearHighlightTimer();
        this.cmAdapter.clearHighlight();

        // 滚动到目标
        await this.raf(() => {
            if (isDestroying) return;
            this.cmAdapter.scrollTo({ pos: from, center: true, yMargin: 100 });
        });

        // 添加高亮
        await this.raf(() => {
            if (isDestroying) return;
            this.cmAdapter.addHighlight(from, to);
        });

        this.cmAdapter.focus();

        // 延时清除高亮
        this.highlightTimer = window.setTimeout(() => {
            this.cmAdapter.clearHighlight();
            this.highlightTimer = null;
        }, 2000);
    }

    clearNavigationHighlight(): void {
        this.clearHighlightTimer();
        this.cmAdapter.clearHighlight();
    }

    // === 内部工具 ===

    private raf(fn: () => void): Promise<void> {
        return new Promise(resolve => {
            requestAnimationFrame(() => { fn(); resolve(); });
        });
    }

    private clearHighlightTimer(): void {
        if (this.highlightTimer) {
            clearTimeout(this.highlightTimer);
            this.highlightTimer = null;
        }
    }

    destroy(): void {
        this.clearHighlightTimer();
        this.headingsCache = null;
        this.positionsCache = null;
    }
}
