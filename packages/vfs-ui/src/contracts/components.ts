import type { VFSNodeUI } from './types';

/** Public component ports; hosts own their implementations and lifetimes. */
export interface Suggestion { id: string; label: string; type?: string; [key: string]: unknown; }
export interface IAutocompleteSource { getSuggestions(query: string): Promise<Suggestion[]>; }
export interface TagEditorOptions { container: HTMLElement; initialTags: string[]; onSave(tags: string[]): void; onCancel(): void; }
export interface TagEditorInstance { destroy?(): void; }
export type TagEditorFactory = (options: TagEditorOptions) => TagEditorInstance | void;
export type MenuItem<T extends object = VFSNodeUI> = { type: 'separator' } | {
    id: string; label: string; iconHTML?: string; disabled?: boolean; type?: 'item';
    hidden?(item: T): boolean; onClick?(item: T): void | Promise<void>;
};
export type ContextMenuBuilder<T extends object = VFSNodeUI> = (item: T, defaults: MenuItem<T>[]) => MenuItem<T>[];
export interface ContextMenuConfig<T extends object = VFSNodeUI> {
    items?: ContextMenuBuilder<T>; bulkItems?(items: T[], defaults: MenuItem<T>[]): MenuItem<T>[];
}
export interface FileCreationConfig {
    resolveParent?(path: string | null): string | null;
    label?: string; title?: string; content?: string;
    startupFileName?: string; startupContent?: string; instant?: boolean;
}
export interface ResourceListOptions<T extends object = VFSNodeUI> {
    sessionListContainer: HTMLElement; documentOutlineContainer?: HTMLElement; initialState?: object;
    contextMenu?: ContextMenuConfig<T>; readOnly?: boolean; initialSidebarCollapsed?: boolean;
    title?: string; searchPlaceholder?: string; fileCreation?: FileCreationConfig;
    components?: { tagEditor?: TagEditorFactory };
}
