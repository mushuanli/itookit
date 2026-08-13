// @itookit/ui-common — shared UI components, contracts, and browser utilities.

// ── Editor / UI contracts ──
export {
    IEditor,
    type EditorOptions,
    type EditorHostContext,
    type EditorEvent,
    type EditorEventMap,
    type EditorEventCallback,
    type SearchResultSource,
    type UnifiedSearchResult,
    type Heading,
    type CollapseExpandResult
} from './interfaces/IEditor';
export { type EditorFactory } from './interfaces/IEditorFactory';
export {
    ISessionUI,
    type MenuItem, type ContextMenuBuilder, type ContextMenuConfig, type SessionUIOptions, type FileCreationConfig,
    type TagEditorOptions, type TagEditorInstance, type TagEditorFactory,
    type SessionManagerEvent,
    type SessionManagerCallback,
    type SessionUIEventMap
} from './interfaces/ISessionUI';

// ── UI components ──
export * from './components/BaseSettingsEditor';
export * from './components/UIComponents';
