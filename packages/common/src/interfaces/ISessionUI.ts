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

export interface SessionUIOptions {
    sessionListContainer: HTMLElement;
    documentOutlineContainer?: HTMLElement;
    initialState?: object;
    contextMenu?: ContextMenuConfig;
    readOnly?: boolean;
    initialSidebarCollapsed?: boolean;
    title?: string;
    searchPlaceholder?: string;
    newSessionContent?: string;
    
    /** 
     * 自定义组件工厂
     * TagEditor 的构造函数引用
     */
    components?: {
        /** UPDATE: Changed type to `new (...args: any[]) => any` to correctly type a class constructor. */
        tagEditor?: new (...args: any[]) => any;
    };
    
    // [新增] 默认文件配置
    /** 当模块/列表为空时，自动创建的默认文件名。如果未提供，则不创建。 */
    defaultFileName?: string;
    /** 默认文件的初始内容 */
    defaultFileContent?: string;

    /** 
     * [新增] 创建按钮的标签名词
     * 例如: "Agent" -> 按钮显示 "+ Agent"
     * 默认为 "File" -> 按钮显示 "+ File"
     */
    createFileLabel?: string;
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
