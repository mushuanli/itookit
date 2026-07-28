// packages/common/src/index.ts

// ── VFS: 文件系统协议（已提取至 @itookit/vfs-protocol；保留 re-export 向后兼容）──
export * from '@itookit/vfs-protocol';

// ── LLM: 已分离至 @itookit/llm-common；保持 re-export 向后兼容 ──
export * from '@itookit/llm-common';

// ── 编辑器 / UI / 导航契约 ──
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
export { type HoverPreviewData } from './interfaces/IHoverPreview';
export { type NavigationRequest } from './interfaces/INavigation';
export {
    ISessionUI,
    type MenuItem, type ContextMenuBuilder, type ContextMenuConfig, type SessionUIOptions, type FileCreationConfig,
    type TagEditorOptions, type TagEditorInstance, type TagEditorFactory,
    type SessionManagerEvent,
    type SessionManagerCallback,
    type SessionUIEventMap
} from './interfaces/ISessionUI';

// ── 日志 ──
export {
    getLogger,
    createModuleLogger
} from './utils/MemoryLogger';
export { LogLevel, LogLevelNames } from './interfaces/ILogger';
export type { LogEntry, LogFilter, LoggerStats, ModuleLog } from './interfaces/ILogger';

// ── 工具 ──
export {
    simpleHash, escapeHTML, escapeAttr,
    generateUUID, generateShortUUID, generateId,
    debounce, isClass,
    guessMimeType, sleep, throttle, retry, withTimeout,
    safeJsonParse, deepClone, truncate,
    formatFileSize, formatDuration, timeAgo,
    isImageMimeType,
    blobToBase64, arrayBufferToBase64, base64ToArrayBuffer,
    calculateHash
} from './utils/utils';
export { buildRenamedFilename, formatDefaultFileTitle } from './utils/filename';
export {
    type TaskCounts,
    type MarkdownMetadata,
    type MentionMap,
    type ParsedMarkdownContent,
    slugify, tryParseJson,
    parseMarkdownContent, extractHeadings, extractTaskCounts,
    extractSummary, extractSearchableText,
    parseMarkdown, formatJsonSummary
} from './utils/MarkdownUtils';

// ── 组件 ──
export * from './components/BaseSettingsEditor';
export * from './components/UIComponents';

// ── 事件 ──
export { NAVIGATION_EVENTS } from './events/navigation-events';

// ── i18n ──
export { t, setLocale, getLocale } from './i18n';
export type { Locale, LocaleKey, LocaleStrings } from './i18n';
export {
    SKILL_TYPE_META, MCP_TRANSPORT_ICONS,
    MODEL_CAPABILITY_META, MODEL_CATEGORY_META, STATUS_META,
    EXECUTOR_TYPE_ICONS, ACTION_ICONS, FEEDBACK_ICONS,
    ENTITY_ICONS, AGENT_ICON_PALETTE, getFileIcon,
} from './i18n/icons';

// ── EventBus ──
export * from './eventbus';

// ── 常 ──
export const FS_MODULE_CHAT = 'chats';
export const FS_MODULE_AGENTS = 'agents';
