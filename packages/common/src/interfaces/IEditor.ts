/**
 * @file common/interfaces/IEditor.ts
 * @description Defines the interface that any editor component must implement to be compatible with MDxWorkspace.
 * @interface
 */

import { ISessionEngine } from './ISessionEngine';
import { NavigationRequest } from './INavigation';

export type SearchResultSource = 'editor' | 'renderer';

export interface UnifiedSearchResult {
    source: SearchResultSource;
    text: string;
    context: string;
    details: any;
}

export interface Heading {
    /** 标题层级 1-6 */
    level: number;
    /** 标题文本 */
    text: string;
    /** 唯一标识符/锚点 (e.g. "heading-introduction-1") */
    id: string;
    /** 子标题列表。如果没有子节点，必须为空数组 []，不可为 undefined */
    children: Heading[];
}

/**
 * 导航选项
 */
export interface NavigateToOptions {
    /** 是否使用平滑滚动动画 */
    smooth?: boolean;
    /** 是否高亮目标元素 */
    highlight?: boolean;
    /** 高亮持续时间（毫秒） */
    highlightDuration?: number;
}

/**
 * 定义编辑器宿主环境提供的标准能力
 * 任何接管编辑器的容器（如 MemoryManager）都应提供这些能力
 */
export interface EditorHostContext {
    /** 切换侧边栏 (无参则 toggle，有参则强制设为该状态) */
    toggleSidebar: (collapsed?: boolean) => void;

    /** 手动触发保存 (用于编辑器内部的 Save 按钮) */
    saveContent: (nodeId: string, content: string) => Promise<void>;

    /** 
     * [通用] 请求导航到系统内的任意资源
     */
    navigate: (request: NavigationRequest) => Promise<void>;
    // 未来可扩展: openFile, showNotification 等
}

// ✨ [重构] 提升 sessionEngine 和 nodeId 为核心配置
export interface EditorOptions {
    /** 初始 Markdown 内容 */
    initialContent?: string;

    /** 初始模式 */
    initialMode?: 'edit' | 'render';

    /** 标题（可选） */
    title?: string;

    /** 
     * 当前编辑器绑定的节点/文件 ID 
     * 结合 sessionEngine 使用，用于定位存储位置、元数据和上下文。
     */
    nodeId?: string;

    /**
     * [新增] 资产归属节点 ID
     * 用于确定图片/附件上传到哪里，以及 @asset/ 路径解析的上下文。
     * - 如果编辑器作为独立页面，通常 ownerNodeId === nodeId。
     * - 如果编辑器是某个大表单的子控件（如评论区、卡片描述），ownerNodeId 可能是父级 ID。
     * - 如果未提供，默认回退使用 nodeId。
     */
    ownerNodeId?: string;

    /**
     * 会话引擎实例。
     * 提供文件系统操作、元数据读写、资源搜索等核心能力。
     * 这是编辑器与数据层交互的统一接口。
     */
    sessionEngine?: ISessionEngine;

    /** 是否只读 */
    readOnly?: boolean;

    /** 
     * [标准注入] 宿主上下文
     * 编辑器通过它控制外部 UI（如侧边栏、全局提示）
     */
    hostContext?: EditorHostContext;

    /** 插件列表 */
    plugins?: any[];

    /** 插件配置 */
    defaultPluginOptions?: Record<string, any>;

    /** 允许传递任何特定于实现的选项 */
    [key: string]: any;
}

// ✨ [核心修改] 增加 'blur' 和 'focus' 事件类型
export type EditorEvent =
    | 'change'            // 内容变化
    | 'interactiveChange' // 用户交互导致的变化
    | 'ready'             // 初始化完成
    | 'modeChanged'       // 编辑/预览模式切换
    | 'blur'              // 失去焦点 (用于自动保存)
    | 'focus'             // 获得焦点
    | 'optimisticUpdate'  // 乐观更新事件
    | 'saved'             // 保存成功
    | 'saveError'         // 保存失败
    | 'blocksCollapsed'   // ✨ [新增] 所有代码块已折叠
    | 'blocksExpanded';   // ✨ [新增] 所有代码块已展开

export type EditorEventCallback = (payload?: any) => void;

/**
 * ✨ [新增] 折叠/展开操作的结果
 */
export interface CollapseExpandResult {
    /** 受影响的代码块数量 */
    affectedCount: number;
    /** 当前状态：是否全部折叠 */
    allCollapsed: boolean;
}

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

    /**
     * [新增] 清理未引用的伴生资源 (可选实现)
     * 用于移除当前文档中不再被引用但仍存在于伴生目录中的文件。
     * 这是一个维护性操作，通常由用户手动触发。
     * @returns 返回清理掉的文件数量，不支持则返回 null
     */
    async pruneAssets(): Promise<number | null> {
        return null;
    }

    // --- ✨ [新增] 代码块折叠/展开接口 ---

    /**
     * 折叠编辑器内所有代码块
     * 
     * @returns 操作结果，包含受影响的代码块数量
     * 
     * @example
     * ```typescript
     * const result = await editor.collapseBlocks();
     * console.log(`已折叠 ${result.affectedCount} 个代码块`);
     * ```
     */
    async collapseBlocks(): Promise<CollapseExpandResult> {
        // 默认实现：不支持的编辑器返回空结果
        return { affectedCount: 0, allCollapsed: true };
    }

    /**
     * 展开编辑器内所有代码块
     * 
     * @returns 操作结果，包含受影响的代码块数量
     * 
     * @example
     * ```typescript
     * const result = await editor.expandBlocks();
     * console.log(`已展开 ${result.affectedCount} 个代码块`);
     * ```
     */
    async expandBlocks(): Promise<CollapseExpandResult> {
        // 默认实现：不支持的编辑器返回空结果
        return { affectedCount: 0, allCollapsed: false };
    }

    /**
     * 切换所有代码块的折叠状态
     * 如果当前有任何展开的代码块，则全部折叠；否则全部展开
     * 
     * @returns 操作结果
     */
    async toggleBlocks(): Promise<CollapseExpandResult> {
        // 默认实现：委托给 collapse
        return this.collapseBlocks();
    }

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

    /**
     * ✨ [重构] 导航到文档内的指定元素
     * 
     * 支持两种模式：
     * - render 模式：通过 DOM querySelector 查找并滚动到目标元素
     * - edit 模式：通过解析 Markdown 源码定位标题位置，使用 CodeMirror 滚动并高亮
     * 
     * @param target - 导航目标，包含 elementId（如 "heading-introduction"）
     * @param options - 导航选项
     */
    abstract navigateTo(target: { elementId: string }, options?: NavigateToOptions): Promise<void>;

    // --- 搜索 ---
    abstract search(query: string): Promise<UnifiedSearchResult[]>;
    abstract gotoMatch(result: UnifiedSearchResult): void;
    abstract clearSearch(): void;

    // --- 事件系统 ---
    abstract on(eventName: EditorEvent, callback: EditorEventCallback): () => void;
}
