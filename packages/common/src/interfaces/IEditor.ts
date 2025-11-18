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
    id: string; // ID必须在文档内唯一
}

// ✨ [最终] 合并为一个统一、可扩展的配置接口
export interface EditorOptions {
  initialContent?: string;
  initialMode?: 'edit' | 'render';
  title?: string;
  nodeId?: string;
  readOnly?: boolean;
  [key: string]: any; // 允许传递任何特定于实现的选项
}

export type EditorEvent = 'change' | 'interactiveChange' | 'ready' | 'modeChanged';
export type EditorEventCallback = (payload?: any) => void;

export abstract class IEditor {
    /**
     * IEditor实例不应直接构造，而应通过异步工厂函数创建。
     */
    protected constructor() {
        if (this.constructor === IEditor) {
            throw new Error("IEditor is an interface and cannot be instantiated directly.");
        }
    }

    /**
     * 异步初始化编辑器DOM和核心服务。
     * 这是创建实例后的第一步。
     * @param container - 编辑器将挂载的HTML元素。
     */
    abstract init(container: HTMLElement): Promise<void>;
    /**
     * [关键修改] 销毁编辑器实例并释放所有资源。
     * 此方法必须返回一个 Promise，以允许调用者等待异步清理/保存操作完成。
     * @returns {Promise<void>} A promise that resolves when destruction is complete.
     */
    abstract destroy(): Promise<void>;

    abstract getText(): string;
    abstract setText(markdown: string): void;
    abstract focus(): void;

    // --- 状态与UI交互 ---
    abstract getMode(): 'edit' | 'render';
    abstract switchToMode(mode: 'edit' | 'render'): Promise<void>;
    abstract setTitle(newTitle: string): void;
    abstract setReadOnly(isReadOnly: boolean): void;

    // --- 内容分析 ---
    abstract readonly commands: Readonly<Record<string, Function>>;

    async getHeadings(): Promise<Heading[]> {
        return [];
    }

    async getSearchableText(): Promise<string> {
        const content = this.getText();
        return content
            .replace(/^#+\s/gm, '')
            .replace(/\[(.*?)\]\(.*?\)/g, '$1')
            .replace(/```[\s\S]*?```/g, '')
            .replace(/`[^`]+`/g, '')
            .trim();
    }
    
    async getSummary(): Promise<string | null> {
        return null;
    }

    abstract navigateTo(target: { elementId: string }, options?: { smooth?: boolean }): Promise<void>;

    // --- 搜索 ---
    abstract search(query: string): Promise<UnifiedSearchResult[]>;
    abstract gotoMatch(result: UnifiedSearchResult): void;
    abstract clearSearch(): void;

    // --- 事件系统 ---
    abstract on(eventName: EditorEvent, callback: EditorEventCallback): () => void;

}
