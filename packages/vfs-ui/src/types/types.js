/**
 * @file vfs-ui/types/types.js
 * @desc Centralized JSDoc type definitions for the VFS-UI library.
 */

/**
 * Represents structured metadata that can be parsed from a file's content.
 * This fixes the error by providing a concrete type for parser results.
 * @typedef {object} FileMetadata
 * @property {{ total: number; completed: number }} [taskCount]
 * @property {number} [clozeCount]
 * @property {number} [mermaidCount]
 */
export const _FileMetadata = {};


/**
 * The UI's internal representation of a VFS node.
 * This is derived from a vfs-core VNode but includes UI-specific properties like `children`.
 * @typedef {object} VFSNodeUI
 * @property {string} id - The unique identifier for the node.
 * @property {'file' | 'directory'} type - The type of the node.
 * @property {string} version - The schema version, e.g., "1.0".
 * @property {object} metadata - Data that the UI understands and manages directly.
 * @property {string} metadata.title - The display name of the node.
 * @property {string[]} metadata.tags - A list of associated tags.
 * @property {string} metadata.createdAt - ISO 8601 timestamp of creation.
 * @property {string} metadata.lastModified - ISO 8601 timestamp of the last modification.
 * @property {string | null} metadata.parentId - The ID of the parent directory.
 * @property {string} metadata.path - The full path of the node within its module.
 * @property {object & FileMetadata} [metadata.custom] - For extra, non-standard metadata. Can hold parsed data.
 * @property {object} [content] - Payload for 'file' types. The UI treats this as a black box.
 * @property {string} content.format - The format identifier, e.g., 'text/markdown', 'application/json'.
 * @property {string} content.summary - A pre-generated plain text summary for display in the list.
 * @property {string} content.searchableText - Pre-generated plain text for full-text search.
 * @property {any} content.data - The actual content payload (often lazy-loaded).
 * 
 * @property {Heading[]} [headings] - Headings are a top-level property for easy access by outline components.
 * @property {VFSNodeUI[]} [children] - Child nodes (only for 'directory' type).
 */
export const _VFSNodeUI = {};

/**
 * @typedef {object} Heading
 * @property {number} level
 * @property {string} text
 * @property {string} elementId
 * @property {Heading[]} [children]
 */
export const _Heading = {};

/**
 * Defines the structure for the UI display settings.
 * @typedef {object} UISettings
 * @property {'lastModified' | 'title'} sortBy - The sorting criteria.
 * @property {'comfortable' | 'compact'} density - The display density of the list.
 * @property {boolean} showSummary - Whether to show the file summary.
 * @property {boolean} showTags - Whether to show file/directory tags.
 * @property {boolean} showBadges - Whether to show metadata badges.
 */
export const _UISettings = {};

/**
 * Represents metadata for a single tag in the global registry.
 * @typedef {object} TagInfo
 * @property {string} name - The canonical name of the tag.
 * @property {string | null} color - An assigned color for the tag.
 * @property {Set<string>} itemIds - A set of node IDs that have this tag.
 */
export const _TagInfo = {};

/**
 * Represents the entire state of the VFS-UI application.
 * @typedef {object} VFSUIState
 * @property {VFSNodeUI[]} items - The hierarchical list of all nodes.
 * @property {string | null} activeId - The ID of the currently selected file.
 * @property {!Set<string>} expandedFolderIds - A set of directory IDs that are expanded.
 * @property {!Set<string>} expandedOutlineIds - A set of file IDs whose inline outlines are expanded.
 * @property {!Set<string>} expandedOutlineH1Ids - A set of H1 element IDs that are expanded in the main outline.
 * @property {!Set<string>} selectedItemIds - A set of node IDs that are currently selected for bulk operations.
 * @property {object | null} creatingItem - Info about an item being created inline ({type, parentId}).
 * @property {object | null} moveOperation - State for the "Move To" operation.
 * @property {string} searchQuery - The current search query string.
 * @property {UISettings} uiSettings - The current UI settings.
 * @property {Map<string, TagInfo>} tags - The global registry for all tags.
 * @property {boolean} isSidebarCollapsed - Whether the sidebar is collapsed.
 * @property {boolean} readOnly - If true, disables all write operations in the UI.
 * @property {'idle' | 'loading' | 'success' | 'error'} status - The current data loading status.
 * @property {Error | null} error - An error object if the status is 'error'.
 */
export const _VFSUIState = {};

/**
 * Defines the structure for a single context menu item.
 * @typedef {object} MenuItem
 * @property {string} id - The unique identifier for the action.
 * @property {string} label - The display text for the menu item.
 * @property {string} [iconHTML] - Optional HTML string for an icon.
 * @property {'item' | 'separator'} [type='item'] - The type of the menu item.
 * @property {(item: VFSNodeUI) => boolean} [hidden] - A function to dynamically hide the item.
 */
export const _MenuItem = {};

/**
 * A function that generates context menu items.
 * @callback ContextMenuBuilder
 * @param {VFSNodeUI} item - The node that was right-clicked.
 * @param {MenuItem[]} defaultItems - The default menu items generated by the library.
 * @returns {MenuItem[]} The final array of menu items to display.
 */
export const _ContextMenuBuilder = {};

/**
 * Configuration object for the context menu.
 * @typedef {object} ContextMenuConfig
 * @property {ContextMenuBuilder} [items] - A function to build the context menu items.
 */
export const _ContextMenuConfig = {};