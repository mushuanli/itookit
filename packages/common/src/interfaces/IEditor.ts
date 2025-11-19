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

// ✨ [核心修改] 增加 'blur' 和 'focus' 事件类型
export type EditorEvent = 
    | 'change'            // 内容变化
    | 'interactiveChange' // 用户交互导致的变化
    | 'ready'             // 初始化完成
    | 'modeChanged'       // 编辑/预览模式切换
    | 'blur'              // 失去焦点 (用于自动保存)
    | 'focus';            // 获得焦点

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
    abstract init(container: HTMLElement, initialContent?: string): Promise<void>;
    
    /**
     * 销毁编辑器实例并释放所有资源。
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

    // --- 【优化】脏检查接口 ---
    /**
     * 检查编辑器内容是否自上次保存或加载以来被用户修改过。
     * @returns {boolean} 如果内容已修改，则返回 true。
     */
    abstract isDirty(): boolean;

    /**
     * 手动设置编辑器的脏状态。
     * @param {boolean} isDirty - 新的脏状态。
     */
    abstract setDirty(isDirty: boolean): void;


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
