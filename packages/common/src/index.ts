// packages/common/src/index.ts

// Export all interfaces
export { 
    IEditor, 
    type EditorOptions, 
    type EditorEvent, 
    type EditorEventCallback, 
    type SearchResultSource, 
    type UnifiedSearchResult, 
    type Heading 
} from './interfaces/IEditor';
export { type EditorFactory } from './interfaces/IEditorFactory';

export { IAutocompleteSource, type Suggestion } from './interfaces/IAutocompleteSource';

export { IMentionSource, type HoverPreviewData } from './interfaces/IMentionSource';
export { IPersistenceAdapter } from './interfaces/IPersistenceAdapter';
export { ISessionUI, 
    type MenuItem, type ContextMenuBuilder, type ContextMenuConfig, type SessionUIOptions,
    type SessionManagerEvent,
    type SessionManagerCallback
 } from './interfaces/ISessionUI';
export { ISessionService } from './interfaces/ISessionService';

export { ISettingsWidget } from './interfaces/ISettingsWidget';

// Export all utils
export { slugify, simpleHash, escapeHTML, generateUUID, generateShortUUID,generateId, debounce, isClass } from './utils/utils';

// Export all components
export { TagEditorComponent, type TagEditorParams } from './components/TagEditor/TagEditorComponent'; // UPDATE: Export TagEditorParams type