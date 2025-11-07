// packages/common/src/index.ts

// Export all interfaces
export { IAutocompleteProvider, type Suggestion } from './interfaces/IAutocompleteProvider';
export { IEditor, type SearchResultSource, type UnifiedSearchResult, type Heading } from './interfaces/IEditor';
export { IMentionProvider } from './interfaces/IMentionProvider';
export { IPersistenceAdapter } from './interfaces/IPersistenceAdapter';
export { ISessionManager, type MenuItem, type ContextMenuBuilder, type ContextMenuConfig, type SessionUIOptions } from './interfaces/ISessionManager';
export { ISessionService } from './interfaces/ISessionService';
export { ISettingsWidget } from './interfaces/ISettingsWidget';

// Export all utils
export { slugify, simpleHash, escapeHTML, generateUUID, generateShortUUID,generateId, debounce, isClass } from './utils/utils';

// Export all components
export { TagEditorComponent } from './components/TagEditor/TagEditorComponent';