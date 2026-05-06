// packages/common/src/index.ts

// Export all interfaces

export {
    LogLevel,
    LogLevelNames,
    type LogEntry,
    type LogFilter,
    type LoggerStats,
    type ILogger,
    type ModuleLog
} from './interfaces/ILogger';

export {
    getLogger,
    createModuleLogger
} from './utils/MemoryLogger';

// ── IModuleFS: 模块文件系统接口及相关类型 ──
export * from './interfaces/fs';

// ── LLM: 连接、消息、补全、Agent、Executor 接口 ──
export * from './interfaces/llm';
export * from './interfaces/tools';
export * from './interfaces/skills';
export * from './interfaces/agent';

export {
    IEditor,
    type EditorOptions,
    type EditorHostContext, // ✅ 导出
    type EditorEvent,
    type EditorEventCallback,
    type SearchResultSource,
    type UnifiedSearchResult,
    type Heading,
    type CollapseExpandResult
} from './interfaces/IEditor';
export { type EditorFactory } from './interfaces/IEditorFactory';
export { type NavigationRequest } from './interfaces/INavigation';
export type { DocumentInfo, ReferenceExtractionResult, IDocumentAnalyzer, GCResult, AnalysisContext } from './interfaces/IDocumentAnalyzer';

export { IAutocompleteSource, type Suggestion } from './interfaces/IAutocompleteSource';

export { IMentionSource, type HoverPreviewData } from './interfaces/IMentionSource';
export {
    ISessionUI,
    type MenuItem, type ContextMenuBuilder, type ContextMenuConfig, type SessionUIOptions, type FileCreationConfig,
    type SessionManagerEvent,
    type SessionManagerCallback
} from './interfaces/ISessionUI';
export {
    type EngineNode,
    type EngineSearchQuery,
    type EngineEventType,
    type EngineEvent,
    type IFSEngine,
    type NodeType,
    type SRSItemData,
} from './interfaces/IFSEngine';

export type { IFile } from './interfaces/IFile';
export type { IMDXFile } from './interfaces/IMDXFile';
export type { IChatFile } from './interfaces/IChatFile';
export type {
    ChatAttachment,
    AppendMessageMeta,
    UpdateMessageMeta,
    ChatNodeMeta,
    ChatNode,
    ChatContextItem,
    ChatManifest,
    BranchTreeNode,
    ChatSessionSettings,
} from './interfaces/chat';
export { DEFAULT_SESSION_SETTINGS } from './interfaces/chat';

export { ISettingsWidget } from './interfaces/ISettingsWidget';

// Export all utils
export {
    simpleHash,
    escapeHTML,
    escapeAttr,
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
    timeAgo,
    isImageMimeType,
    blobToBase64,
    arrayBufferToBase64,
    base64ToArrayBuffer,
    calculateHash
} from './utils/utils';
export { MarkdownAnalyzer } from './utils/MarkdownAnalyzer';
export { buildRenamedFilename, formatDefaultFileTitle } from './utils/filename';
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
export { NAVIGATION_EVENTS } from './events/navigation-events';

export type { RestoreStatus, RestorableItem } from './types/types';

// ── TTY: 终端设备接口 ──
export * from './interfaces/tty';

// ── i18n: 图标常量、字符串本地化 ──
export { t, setLocale, getLocale } from './i18n';
export type { Locale, LocaleKey, LocaleStrings } from './i18n';
export {
    SKILL_TYPE_META,
    MCP_TRANSPORT_ICONS,
    STATUS_META,
    EXECUTOR_TYPE_ICONS,
    ACTION_ICONS,
    FEEDBACK_ICONS,
    ENTITY_ICONS,
    AGENT_ICON_PALETTE,
    getFileIcon,
} from './i18n/icons';

// Constants
export const FS_MODULE_CHAT = 'chats';
export const FS_MODULE_AGENTS = 'agents';
