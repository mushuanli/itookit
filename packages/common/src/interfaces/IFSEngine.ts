/**
 * @file common/interfaces/IFSEngine.ts
 * @desc Defines the standard contract for a module-scoped virtual filesystem engine.
 * Enables UI and plugins to work transparently with different backends
 * (VFS, REST API, Electron FS, in-memory, etc.).
 *
 * @deprecated 使用 IModuleFS（完整模块接口）或 IFSDriver（CRUD + 事件驱动接口）替代。
 *   - UI 层消费方（文件树、编辑器）：改用 IModuleFS
 *   - IFile / IMDXFile / IChatFile 工厂：参数已改为 IModuleFS
 *   - EngineNode → FSNode，EngineEventType → FSEventType，EngineEvent → FSEvent<E>
 */
export type NodeType = 'file' | 'directory';

/**
 * Generic node data structure
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
 * SRS (Spaced Repetition System) item data
 */
export interface SRSItemData {
  /** Next review time (Unix timestamp) */
  dueAt: number;
  /** Last review time (Unix timestamp) */
  lastReviewedAt: number;
  /** Review count */
  reviewCount: number;
  /** Current interval (days) */
  interval: number;
  /** Ease factor */
  ease: number;
  /** Content snippet (optional) */
  snippet?: string;
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
