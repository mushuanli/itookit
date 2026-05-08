/**
 * @file common/interfaces/IFSEngine.ts
 *
 * @deprecated 整个文件已废弃。改用：
 *   - IModuleFS / IFSDriver（文件操作）
 *   - FSNode / FSEventType / FSEvent<E>（节点 / 事件类型）
 *   - SRSItemData from '@itookit/common' srs（SRS 数据）
 *
 * 剩余消费方：VFSModuleEngine（deprecated adapter）、AssetManagerUI。
 * 待这两处迁移完成后可整体删除。
 */

// SRSItemData is now canonical in srs/ISRSService — import for use in this file, re-export for callers
import type { SRSItemData } from './srs/ISRSService';
export type { SRSItemData };

/** @deprecated 使用 FSNodeType 替代 */
export type NodeType = 'file' | 'directory';

/**
 * Generic node data structure
 * @deprecated 使用 FSNode (discriminated union) 替代
 */
export interface EngineNode {
  id: string;
  parentId: string | null;
  name: string;

  /**
   * Node type — string literal compatible with VNodeType enum values.
   */
  type: NodeType;

  /** File content (only when type === 'file') */
  content?: string | ArrayBuffer;
  /** Child nodes (only when type === 'directory') */
  children?: EngineNode[];
  createdAt: number;
  modifiedAt: number;
  /** Full logical path */
  path: string;
  /**
   * File size in bytes.
   * - File node: content size
   * - Directory node: 0 or sum of children (implementation-dependent)
   * - Optional, defaults to 0
   */
  size?: number;

  tags?: string[];
  metadata?: Record<string, unknown>;
  /** Owning module ID (for multi-module / namespace systems) */
  moduleId?: string;

  /**
   * Custom node icon (emoji or URL).
   * When present, UI should prefer this over the default file/folder icon.
   */
  icon?: string;

  /**
   * Associated asset directory ID.
   * O(1) lookup for a node's companion asset directory.
   * - File: points to `.filename/` directory
   * - Directory: points to `.assets/` subdirectory
   * Undefined when no asset directory exists.
   */
  assetDirId?: string;
}

/**
 * Search query parameters
 */
export interface EngineSearchQuery {
  /** Node type filter */
  type?: NodeType;
  /** Tag filter */
  tags?: string[];
  text?: string;
  limit?: number;

  /**
   * Search scope for Mention and cross-module queries.
   * - undefined / empty: default to engine's bound context (current module)
   * - ['*']: global search (all modules)
   * - ['modA', 'modB']: specific modules
   */
  scope?: string[];
}

export type EngineEventType =
  | 'node:created'
  | 'node:updated'
  | 'node:deleted'
  | 'node:moved'
  | 'node:renamed'
  | 'node:batch_updated'
  | 'node:batch_moved'
  | 'node:batch_deleted'
  | 'error';

export interface EngineEvent {
  type: EngineEventType;
  /** Event payload — typically contains nodeId, parentId, updatedNodeIds, etc. */
  payload: unknown;
}


/**
 * Module-scoped virtual filesystem engine.
 *
 * Sits between UI layers and the underlying storage backend.
 * Each instance is bound to a specific module (chroot-isolated namespace).
 * Use IFile / IMDXFile / IChatFile for per-file operations.
 *
 * @deprecated 使用 IModuleFS 替代
 */
export interface IFSEngine {
  // --- Read Operations ---
  init(): Promise<void>;
  /** List children of a directory (pass '/' for root) */
  getChildren(parentId: string): Promise<EngineNode[]>;
  /** Read the content of a single node */
  readContent(id: string): Promise<string | ArrayBuffer>;
  /** Get node details by ID */
  getNode(id: string): Promise<EngineNode | null>;
  /**
   * Search nodes.
   * Supports cross-module search via the scope parameter.
   */
  search(query: EngineSearchQuery): Promise<EngineNode[]>;
  /** Get all available tag definitions (optional implementation) */
  getAllTags?(): Promise<Array<{ name: string; color?: string }>>;

  // --- Write Operations ---
  /** Create a file (path resolution is handled internally by the engine) */
  createFile(name: string, parentId: string | null, content?: string | ArrayBuffer): Promise<EngineNode>;
  /**
   * Batch-create files (optional implementation).
   * Falls back to Promise.all if not implemented.
   */
  createFiles?(files: Array<{ title: string; content: string | ArrayBuffer }>, parentId: string | null): Promise<EngineNode[]>;
  /** Create a directory */
  createDirectory(name: string, parentId: string | null): Promise<EngineNode>;

  /**
   * Create an asset associated with a given owner node.
   * Engine handles storage location (.filename/asset.png) and lazy directory creation.
   * @param ownerNodeId - The owning file's node ID
   * @param filename - Asset filename (e.g. image.png)
   * @param content - Binary content
   * @returns The created asset node
   */
  createAsset(ownerNodeId: string, filename: string, content: string | ArrayBuffer): Promise<EngineNode>;

  /**
   * Get the asset directory ID for a given node.
   * Returns null when none exists.
   */
  getAssetDirectoryId(ownerNodeId: string): Promise<string | null>;

  /**
   * Get all asset files for a given node (optional implementation).
   */
  getAssets?(ownerNodeId: string): Promise<EngineNode[]>;

  /** Write / overwrite file content */
  writeContent(id: string, content: string | ArrayBuffer): Promise<void>;
  /** Rename a node */
  rename(id: string, newName: string): Promise<void>;
  /** Move nodes to a new parent (supports batch IDs) */
  move(ids: string[], targetParentId: string | null): Promise<void>;
  /** Delete nodes (supports batch IDs) */
  delete(ids: string[]): Promise<void>;
  /** Update metadata (typically merged) */
  updateMetadata(id: string, metadata: Record<string, unknown>): Promise<void>;
  /** Set node tags (full replacement) */
  setTags(id: string, tags: string[]): Promise<void>;

  /**
   * Batch-set tags (optional implementation).
   * Defined as optional for backward compatibility.
   */
  setTagsBatch?(updates: Array<{ id: string; tags: string[] }>): Promise<void>;

  // --- SRS Support (all optional) ---
  getSRSStatus?(fileId: string): Promise<Record<string, SRSItemData>>;
  updateSRSStatus?(fileId: string, clozeId: string, status: SRSItemData): Promise<void>;
  getDueCards?(limit?: number): Promise<Array<{
    fileId: string;
    clozeId: string;
    status: SRSItemData;
  }>>;

  // --- Events ---
  /** Subscribe to data change events */
  on(event: EngineEventType, callback: (event: EngineEvent) => void): () => void;
}
