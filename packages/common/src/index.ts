// packages/common/src/index.ts

// Export all interfaces
export { IAutocompleteProvider, type Suggestion } from './interfaces/IAutocompleteProvider';
export { IEditor, type SearchResultSource, type UnifiedSearchResult, type Heading } from './interfaces/IEditor';
export { IMentionProvider, type HoverPreviewData } from './interfaces/IMentionProvider'; // UPDATE: Export new HoverPreviewData interface
export { IPersistenceAdapter } from './interfaces/IPersistenceAdapter';
export { ISessionManager, 
    type MenuItem, type ContextMenuBuilder, type ContextMenuConfig, type SessionUIOptions,
    type SessionManagerEvent,
    type SessionManagerCallback
 } from './interfaces/ISessionManager';
export { ISessionService } from './interfaces/ISessionService';
export { ISettingsWidget } from './interfaces/ISettingsWidget';

// Export all utils
export { slugify, simpleHash, escapeHTML, generateUUID, generateShortUUID,generateId, debounce, isClass } from './utils/utils';

// Export all components
export { TagEditorComponent, type TagEditorParams } from './components/TagEditor/TagEditorComponent'; // UPDATE: Export TagEditorParams type