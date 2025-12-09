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
export {type EngineNode,type EngineSearchQuery,type EngineEventType,type EngineEvent,type ISessionEngine} from './interfaces/ISessionEngine';

export { ISettingsWidget } from './interfaces/ISettingsWidget';

// Export all utils
export { slugify, simpleHash, escapeHTML, generateUUID, generateShortUUID, generateId, debounce, isClass } from './utils/utils';

// Export all components
export { TagEditorComponent, type TagEditorParams } from './components/TagEditor/TagEditorComponent'; 
export * from './components/BaseSettingsEditor';
export * from './components/UIComponents';

// LLM Interfaces
export * from './interfaces/llm/ILLM';
export * from './interfaces/llm/IExecutor';
// ✨ [新增] 导出 Agent 定义
export * from './interfaces/llm/IAgent';
export type { ILLMSessionEngine, ChatContextItem } from './interfaces/llm/session/ILLMSessionEngine';
export type { ChatManifest, ChatNode, IYamlParser,MCPServer } from './interfaces/llm/session/types';

export const FS_MODULE_CHAT='chats';
export const FS_MODULE_AGENTS='agents';