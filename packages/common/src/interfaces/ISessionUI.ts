/**
 * @file common/interfaces/ISessionUI.ts
 * @description Defines the public interface that a session management module must implement.
 */

interface IRegularMenuItem {
    id: string;
    label: string;
    iconHTML?: string;
    type?: 'item'; // 'type' 是可辨识的属性
    hidden?: (item: Record<string, any>) => boolean;
    /** Custom click handler. When provided, bypasses the command-bus dispatch. */
    onClick?: (item: object) => void;
}

// 定义一个分割线
interface ISeparatorMenuItem {
    type: 'separator';
}

// MenuItem 现在是一个可辨识联合类型
export type MenuItem = IRegularMenuItem | ISeparatorMenuItem;


export type ContextMenuBuilder = (item: object, defaultItems: MenuItem[]) => MenuItem[];

export interface ContextMenuConfig {
    items?: ContextMenuBuilder;
}

/**
 * Options controlling new-file creation behaviour.
 * Grouped to keep SessionUIOptions focused on session-level concerns.
 */
export interface FileCreationConfig {
    /** Label on the "+ New" button (e.g. "Chat", "Agent"). Default: "File". */
    label?: string;
    /** Title pre-filled in the new-file inline input. */
    title?: string;
    /** Body content template for newly created files. */
    content?: string;
    /** Auto-create this file on startup when the module has zero items. */
    startupFileName?: string;
    /** Content for the auto-created startup file. */
    startupContent?: string;
}

export interface SessionUIOptions {
    sessionListContainer: HTMLElement;
    documentOutlineContainer?: HTMLElement;
    initialState?: object;
    contextMenu?: ContextMenuConfig;
    readOnly?: boolean;
    initialSidebarCollapsed?: boolean;
    title?: string;
    searchPlaceholder?: string;

    /** New-file creation defaults. When omitted, the "+" button still works but without pre-fill or startup file. */
    fileCreation?: FileCreationConfig;

    /**
     * 自定义组件工厂
     * TagEditor 的构造函数引用
     */
    components?: {
        /** UPDATE: Changed type to `new (...args: any[]) => any` to correctly type a class constructor. */
        tagEditor?: new (...args: any[]) => any;
    };
}

export type SessionManagerEvent = 
    | 'sessionSelected' 
    | 'navigateToHeading' 
    | 'importRequested' 
    | 'sidebarStateChanged' 
    | 'menuItemClicked' 
    | 'stateChanged';

export type SessionManagerCallback = (payload: any) => void;

/**
 * Session UI 主接口
 * @template TSession 会话对象类型 (如 VFSNodeUI)
 * @template TService 服务层类型 (如 VFSService)
 */
export abstract class ISessionUI<TSession extends object, TService extends object> {
    protected constructor() {
        if (this.constructor === ISessionUI) {
            throw new Error("ISessionUI is an interface and cannot be instantiated directly.");
        }
    }

    abstract readonly sessionService: TService;

    abstract start(): Promise<TSession | undefined>;
    abstract getActiveSession(): TSession | undefined;
    abstract updateSessionContent(sessionId: string, newContent: string): Promise<void>;
    abstract toggleSidebar(): void;
    abstract setTitle(newTitle: string): void;
    
    abstract on(eventName: SessionManagerEvent, callback: SessionManagerCallback): () => void;
    abstract destroy(): void;
}
