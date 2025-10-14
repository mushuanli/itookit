// #sidebar/types/types.js
/**
 * @file Centralized JSDoc type definitions for the SessionUI library.
 * This file does not export any code, but is used by IDEs for type hinting.
 */

// We export empty objects to make this a valid ES module that can be "imported"
// for its type definitions without actually running any code.


/**
 * [MIGRATION] The standardized structure for any item managed by the sidebar.
 * This replaces the old `_Session` type and is the core of the new agnostic architecture.
 * @typedef {object} WorkspaceItem
 * @property {string} id - The unique identifier for the item.
 * @property {'item' | 'folder'} type - The type of the item.
 * @property {string} version - The version of the schema, e.g., "1.0".
 * @property {object} metadata - Data that the sidebar understands and manages directly.
 * @property {string} metadata.title - The display title.
 * @property {string[]} metadata.tags - A list of associated tags.
 * @property {string} metadata.createdAt - ISO 8601 timestamp of creation.
 * @property {string} metadata.lastModified - ISO 8601 timestamp of the last modification.
 * @property {string | null} metadata.parentId - The ID of the parent folder.
 * @property {object} [metadata.custom] - For extra, non-standard metadata like isPinned or icons.
 * @property {object} [content] - Payload for 'item' types. The sidebar treats this as a black box.
 * @property {string} content.format - The format identifier, e.g., 'markdown', 'llm-chat-v1'.
 * @property {string} content.summary - A pre-generated plain text summary for display in the list.
 * @property {string} content.searchableText - Pre-generated plain text for full-text search.
 * @property {any} content.data - The actual content payload (e.g., a string for markdown, an object for chat).
 * 
 * @property {Heading[]} [headings] - Headings are a top-level property for easy access by outline components.
 * @property {WorkspaceItem[]} [children] - Child items (only for 'folder' type).
 */
export const _WorkspaceItem = {};

/**
 * @typedef {object} Heading
 * @property {number} level
 * @property {string} text
 * @property {string} elementId
 * @property {Heading[]} [children]
 */
export const _Heading = {};

/**
 * @typedef {object} SessionMetadata
 * @property {{ total: number; completed: number }} [taskCount]
 * @property {number} [clozeCount]
 * @property {number} [mermaidCount]
 */
export const _SessionMetadata = {};

/**
 * Defines the structure for the UI display settings.
 * @typedef {object} UISettings
 * @property {'lastModified' | 'creationTime' | 'title'} sortBy - The sorting criteria.
 * @property {'comfortable' | 'compact'} density - The display density of the list.
 * @property {boolean} showSummary - Whether to show the session summary.
 * @property {boolean} showTags - Whether to show session tags.
 * @property {boolean} showBadges - Whether to show metadata badges.
 */
export const _UISettings = {};

// [TAGS-FEATURE] Start: New type definitions for the tagging system.
/**
 * Represents metadata for a single tag in the global registry.
 * @typedef {object} TagInfo
 * @property {string} name - The canonical name of the tag.
 * @property {string | null} color - The assigned color for the tag (future use).
 * @property {Set<string>} itemIds - A set of item IDs that have this tag.
 */
export const _TagInfo = {};
// [TAGS-FEATURE] End

/**
 * Represents the entire state of the SessionUI application.
 * @typedef {object} SessionState
 * @property {WorkspaceItem[]} items - The hierarchical list of all items.
 * @property {string | null} activeId - The ID of the currently selected session.
 * @property {!Set<string>} expandedFolderIds - A set of folder IDs that are expanded.
 * @property {!Set<string>} expandedOutlineIds - A set of session IDs whose inline outlines are expanded.
 * @property {string} searchQuery - The current search query string.
 * @property {UISettings} uiSettings - The current UI settings.
 * @property {Map<string, TagInfo>} tags - [TAGS-FEATURE] The global registry for all tags.
 * @property {'idle' | 'loading' | 'success' | 'error'} status - The current loading status of the application.
 * @property {Error | null} error - An error object if the status is 'error'.
 */
export const _SessionState = {};

/**
 * [MODIFIED] Defines the structure for a single context menu item.
 * The `hidden` function now receives a WorkspaceItem.
 * @typedef {object} MenuItem
 * @property {string} id - The unique identifier for the action.
 * @property {string} label - The display text for the menu item.
 * @property {string} [iconHTML] - Optional HTML string for an icon.
 * @property {'item' | 'separator'} [type='item'] - The type of the menu item.
 * @property {(item: WorkspaceItem) => boolean} [hidden] - A function to dynamically hide the item.
 */
export const _MenuItem = {};

/**
 * [MODIFIED] A function that generates context menu items, now receiving a WorkspaceItem.
 * @callback ContextMenuBuilder
 * @param {WorkspaceItem} item - The item that was right-clicked.
 * @param {MenuItem[]} defaultItems - The default menu items generated by the library.
 * @returns {MenuItem[]} The final array of menu items to display.
 */
export const _ContextMenuBuilder = {};

/**
 * [新增] Configuration object for the context menu.
 * @typedef {object} ContextMenuConfig
 * @property {ContextMenuBuilder} [items] - A function to build the context menu items.
 */
export const _ContextMenuConfig = {};