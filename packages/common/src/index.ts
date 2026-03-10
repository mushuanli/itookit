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

export type {
    // 数据类型
    FSNodeType,
    FSNode,
    FSSearchQuery,

    // 事件类型
    FSEventType,
    FSEvent,
    FSEventPayloadMap,

    // 事件载荷 — 单节点
    FSNodeCreatedPayload,
    FSNodeUpdatedPayload,
    FSNodeDeletedPayload,
    FSNodeMovedPayload,
    FSNodeCopiedPayload,
    FSNodeRenamedPayload,

    // 事件载荷 — 错误
    FSErrorPayload,

    // 核心接口
    IModuleFS,

    // ── IVFSManager: 系统级 VFS 管理接口及相关类型 ──

    ModuleInfo,
    ModuleMountOptions,
    VFSManagerEventType,
    VFSManagerEvent,
    GlobalTagInfo,
    SyncableFileInfo,
    IVFSManager,

    // ── 工厂类型（仅初始化层使用） ──
    VFSFactoryOptions,
    BrowserVFSOptions,
    ElectronVFSOptions,
    VFSFactory,
} from './interfaces/fs';
export type { SRSItemData, SRSCardRef, SRSStats, ISRSService } from './interfaces/srs';
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
export { IPersistenceAdapter } from './interfaces/IPersistenceAdapter';
export {
    ISessionUI,
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
    //type SRSItemData
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
    timeAgo,
    isImageMimeType,
    blobToBase64,
    arrayBufferToBase64,
    base64ToArrayBuffer,
    calculateHash
} from './utils/utils';
export { MarkdownAnalyzer } from './utils/MarkdownAnalyzer';
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

// Constants
export const FS_MODULE_CHAT = 'chats';
export const FS_MODULE_AGENTS = 'agents';
