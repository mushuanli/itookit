// packages/common/src/index.ts

// Export all interfaces
export { 
    IEditor, 
    type EditorOptions, 
    type EditorHostContext, // ✅ 导出
    type EditorEvent, 
    type EditorEventCallback, 
    type SearchResultSource, 
    type UnifiedSearchResult, 
    type Heading 
} from './interfaces/IEditor';
export { type EditorFactory } from './interfaces/IEditorFactory';
export {type NavigationRequest} from './interfaces/INavigation';
export type {DocumentInfo,ReferenceExtractionResult,IDocumentAnalyzer,GCResult,AnalysisContext} from './interfaces/IDocumentAnalyzer';

export { IAutocompleteSource, type Suggestion } from './interfaces/IAutocompleteSource';

export { IMentionSource, type HoverPreviewData } from './interfaces/IMentionSource';
export { IPersistenceAdapter } from './interfaces/IPersistenceAdapter';
export { ISessionUI, 
    type MenuItem, type ContextMenuBuilder, type ContextMenuConfig, type SessionUIOptions,
    type SessionManagerEvent,
    type SessionManagerCallback
 } from './interfaces/ISessionUI';
export {
    type EngineNode,
    type EngineSearchQuery,
    type EngineEventType,
    type EngineEvent,
    type ISessionEngine,
    type NodeType,
    type SRSItemData
} from './interfaces/ISessionEngine';

export { ISettingsWidget } from './interfaces/ISettingsWidget';

// Export all utils
export { 
    simpleHash, 
    escapeHTML, 
    generateUUID, 
    generateShortUUID, 
    generateId, 
    debounce, 
    isClass,
    guessMimeType,
    sleep, 
    throttle, 
    retry, 
    withTimeout, 
    safeJsonParse, 
    deepClone, 
    truncate, 
    formatFileSize, 
    formatDuration, 
    timeAgo
} from './utils/utils';
export {MarkdownAnalyzer} from './utils/MarkdownAnalyzer';
export {
  type TaskCounts,
  type MarkdownMetadata,
  type ParsedMarkdownContent,
  
  slugify, 
  tryParseJson, // 使用新版
  parseMarkdownContent,
  extractHeadings,
  extractTaskCounts,
  extractSummary,
  extractSearchableText,
  parseMarkdown,
  formatJsonSummary
} from './utils/MarkdownUtils';

// Export all components
export * from './components/BaseSettingsEditor';
export * from './components/UIComponents';

// Constants
export const FS_MODULE_CHAT = 'chats';
export const FS_MODULE_AGENTS = 'agents';
