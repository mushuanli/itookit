/**
 * @file common/interfaces/ISessionManager.ts
 * @description Defines the public interface that a session management module must implement.
 */
import { ISessionService } from './ISessionService';
import { IPersistenceAdapter } from './IPersistenceAdapter';

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
    components?: {
        /** UPDATE: Changed type to `new (...args: any[]) => any` to correctly type a class constructor. */
        tagEditor?: new (...args: any[]) => any;
    };
}

/** FIX: Export event types for use in JSDoc */
export type SessionManagerEvent = 'sessionSelected' | 'navigateToHeading' | 'importRequested' | 'sidebarStateChanged' | 'menuItemClicked' | 'stateChanged';
export type SessionManagerCallback = (payload: any) => void;

export abstract class ISessionManager<TSession extends object, TService extends ISessionService<any>> {
    protected constructor() {
        if (this.constructor === ISessionManager) {
            throw new Error("ISessionManager is an interface and cannot be instantiated directly.");
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
