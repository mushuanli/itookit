import type { MDxPlugin, ScopedPersistenceStore } from '../core/types';

export interface Heading { level: number; text: string; id: string; children: Heading[]; }
export interface HoverPreviewData { title: string; contentHTML: string; icon?: string; }
export interface CollapseExpandResult { affectedCount: number; allCollapsed: boolean; }
export type UnifiedSearchResult = { text: string; context: string } & (
    { source: 'editor'; details: { from: number; to: number } } |
    { source: 'renderer'; details: { element: HTMLElement } }
);
export interface EditorFileReference { path: string; content: string; selection: boolean; }

/** Storage and attachment lifetimes are owned by the host. */
export interface AssetProvider {
    read(name: string): Promise<ArrayBuffer | null>;
    upload?(name: string, content: ArrayBuffer): Promise<{ name: string }>;
    prune?(): Promise<number>;
    mimeType?(name: string): string;
}
export type StoreFactory = (pluginName: string, instanceId: string, documentPath?: string) => ScopedPersistenceStore;
export interface EditorHost {
    openDocument?(path: string, anchor?: string): Promise<void>;
    renameDocument?(path: string, title: string): Promise<{ path: string; title: string }>;
    notify?(message: string, level: 'info' | 'success' | 'error'): void;
}
export interface EditorOptions {
    signal?: AbortSignal;
    documentPath?: string;
    onDocumentPathChange?: (path: string) => void;
    initialContent?: string;
    onSave?: (content: string) => Promise<void>;
    initialMode?: 'edit' | 'render';
    contentFormat?: 'markdown' | 'text';
    title?: string;
    language?: string;
    locale?: 'zh-CN' | 'en';
    translate?: (key: string) => string;
    readOnly?: boolean;
    host?: EditorHost;
    assets?: AssetProvider;
    storeFactory?: StoreFactory;
    plugins?: unknown[];
    defaultPluginOptions?: Record<string, unknown>;
}
export interface EditorEventMap {
    change: undefined; interactiveChange: undefined; ready: undefined; modeChanged: { mode: 'edit' | 'render' };
    blur: undefined; focus: undefined; optimisticUpdate: undefined; saved: undefined; saveError: unknown;
    contentLoaded: undefined; error: unknown; blocksCollapsed: CollapseExpandResult; blocksExpanded: CollapseExpandResult;
}
export type EditorEvent = keyof EditorEventMap;
export type EditorEventCallback<E extends EditorEvent = EditorEvent> = (payload: EditorEventMap[E]) => void;
export interface IEditor {
    init(container: HTMLElement, initialContent?: string): Promise<void>;
    destroy(): Promise<void>;
    getText(): string;
    setText(text: string): void;
    focus(): void;
    getMode(): 'edit' | 'render';
    switchToMode(mode: 'edit' | 'render'): Promise<void>;
    setTitle(title: string): void;
    setReadOnly(readOnly: boolean): void;
    isDirty(): boolean;
    setDirty(dirty: boolean): void;
    flushPendingSave(): Promise<void>;
    save(): Promise<void>;
    updateDocumentPath(path: string): void;
    cancelPendingRender(): void;
    pruneAssets(): Promise<number | null>;
    collapseBlocks(): Promise<CollapseExpandResult>;
    expandBlocks(): Promise<CollapseExpandResult>;
    toggleBlocks(): Promise<CollapseExpandResult>;
    readonly commands: Readonly<Record<string, Function>>;
    getHeadings(): Promise<Heading[]>;
    getSearchableText(): Promise<string>;
    getSummary(): Promise<string | null>;
    navigateTo(target: { elementId: string }, options?: { smooth?: boolean }): Promise<void>;
    search(query: string): Promise<UnifiedSearchResult[]>;
    gotoMatch(result: UnifiedSearchResult): void;
    clearSearch(): void;
    on<E extends EditorEvent>(event: E, callback: EditorEventCallback<E>): () => void;
    use(plugin: MDxPlugin): this;
}
export type EditorFactory = (container: HTMLElement, options: EditorOptions) => Promise<IEditor>;
export function editorFilePath(options: EditorOptions): string | undefined { return options.documentPath; }
