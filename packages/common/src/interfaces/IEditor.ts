/**
 * @file common/interfaces/IEditor.ts
 * @description Defines the interface that any editor component must implement to be compatible with MDxWorkspace.
 * @interface
 */

export type SearchResultSource = 'editor' | 'renderer';

export interface UnifiedSearchResult {
    source: SearchResultSource;
    text: string;
    context: string;
    details: any;
}

export interface Heading {
    level: number;
    text: string;
    id: string;
}

type EditorEvent = 'change' | 'interactiveChange' | 'ready';
type EditorEventCallback = (payload?: any) => void;

export abstract class IEditor {
    constructor(options: any) {
        if (this.constructor === IEditor) {
            throw new Error("IEditor is an interface and cannot be instantiated directly.");
        }
    }

    /**
     * 💡 新增: 异步初始化方法
     * 这是创建编辑器实例后的第一步，用于设置 DOM 和加载异步资源。
     * @param container - 编辑器将挂载的 HTML 元素。
     * @param initialContent - 编辑器的初始 Markdown 内容。
     */
    abstract init(container: HTMLElement, initialContent?: string): Promise<void>;

    abstract readonly commands: Readonly<Record<string, Function>>;
    abstract setText(markdown: string): void;
    abstract getText(): string;
    
    async getSearchableText(): Promise<string> {
        const content = this.getText();
        return content
            .replace(/^#+\s/gm, '')
            .replace(/\[(.*?)\]\(.*?\)/g, '$1')
            .replace(/```[\s\S]*?```/g, '')
            .replace(/`[^`]+`/g, '')
            .trim();
    }
    
    async getHeadings(): Promise<Heading[]> {
        return [];
    }

    async getSummary(): Promise<string | null> {
        return null;
    }

    abstract setTitle(newTitle: string): void;
    abstract navigateTo(target: { elementId: string }, options?: { smooth?: boolean }): Promise<void>;
    abstract setReadOnly(isReadOnly: boolean): void;
    abstract focus(): void;
    abstract search(query: string): Promise<UnifiedSearchResult[]>;
    abstract gotoMatch(result: UnifiedSearchResult): void;
    abstract clearSearch(): void;

    abstract on(eventName: EditorEvent, callback: EditorEventCallback): () => void;

    /**
     * [关键修改] 销毁编辑器实例并释放所有资源。
     * 此方法必须返回一个 Promise，以允许调用者等待异步清理/保存操作完成。
     * @returns {Promise<void>} A promise that resolves when destruction is complete.
     */
    abstract destroy(): Promise<void>;
}
