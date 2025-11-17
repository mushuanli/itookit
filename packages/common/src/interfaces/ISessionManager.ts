/**
 * @file common/interfaces/ISessionManager.ts
 * @description Defines the public interface that a session management module must implement.
 */
import { ISessionService } from './ISessionService';
import { IPersistenceAdapter } from './IPersistenceAdapter';

export interface MenuItem {
    id: string;
    label: string;
    iconHTML?: string;
    type?: 'item' | 'separator';
    /** UPDATE: Changed type from `object` to `Record<string, any>` for better type safety. */
    hidden?: (item: Record<string, any>) => boolean;
}

export type ContextMenuBuilder = (item: object, defaultItems: MenuItem[]) => MenuItem[];

export interface ContextMenuConfig {
    items?: ContextMenuBuilder;
}

export interface SessionUIOptions {
    sessionListContainer: HTMLElement;
    documentOutlineContainer?: HTMLElement;
    storageKey: string;
    initialState?: object;
    persistenceAdapter?: IPersistenceAdapter;
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
    /** FIX: Add optional loadDataOnStart property to the interface */
    loadDataOnStart?: boolean;
}

/** FIX: Export event types for use in JSDoc */
export type SessionManagerEvent = 'sessionSelected' | 'navigateToHeading' | 'importRequested' | 'sidebarStateChanged' | 'menuItemClicked' | 'stateChanged';
export type SessionManagerCallback = (payload: any) => void;

export abstract class ISessionManager {
    protected constructor() {
        if (this.constructor === ISessionManager) {
            throw new Error("ISessionManager is an interface and cannot be instantiated directly.");
        }
    }

    abstract readonly sessionService: ISessionService;

    abstract start(): Promise<object | undefined>;
    abstract getActiveSession(): object | undefined;
    abstract updateSessionContent(sessionId: string, newContent: string): Promise<void>;
    abstract toggleSidebar(): void;
    abstract setTitle(newTitle: string): void;
    
    abstract on(eventName: SessionManagerEvent, callback: SessionManagerCallback): () => void; // Returns unsubscribe function
    abstract destroy(): void;
}
