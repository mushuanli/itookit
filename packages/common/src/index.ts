// packages/common/src/index.ts

// ── LLM: 已分离至 @itookit/llm-common；保持 re-export 向后兼容 ──
export * from '@itookit/llm-common';

// ── UI 契约已迁移至 @itookit/ui-common（IEditor/ISessionUI/EditorFactory 及 UI 组件）──

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
    sleep, throttle, retry, withTimeout,
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

// ── 事件 ──
export { NAVIGATION_EVENTS } from './events/navigation-events';
export type { NavigationRequest } from './interfaces/INavigation';
export type { HoverPreviewData } from './interfaces/IHoverPreview';
export type { Heading } from './types/heading';

// ── i18n ──
export { t, setLocale, getLocale } from './i18n';
export type { Locale, LocaleKey, LocaleStrings } from './i18n';
export {
    SKILL_TYPE_META, MCP_TRANSPORT_ICONS,
    MODEL_CAPABILITY_META, MODEL_CATEGORY_META, STATUS_META,
    EXECUTOR_TYPE_ICONS, ACTION_ICONS, FEEDBACK_ICONS,
    ENTITY_ICONS, AGENT_ICON_PALETTE, getFileIcon,
} from './i18n/icons';

// ── EventBus: 已移入 @itookit/vfs-core；消费方从 vfs-core 导入 ──
