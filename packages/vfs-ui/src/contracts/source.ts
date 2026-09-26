
export interface ResourceRef { readonly viewId: string; readonly path: string }
export interface BrowserNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly kind: 'file' | 'directory' | 'group';
  readonly label: string;
  readonly resource?: ResourceRef;
  readonly expandable?: boolean;
  readonly icon?: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly createdAt?: number;
  readonly modifiedAt?: number;
  readonly readOnly?: boolean;
  readonly presentation?: 'row' | 'drawer';
}
export interface SourceChange { readonly parentIds?: readonly (string | null)[] }
/** IDs are opaque. Only the VFS adapter interprets paths. */
export interface BrowserSource {
  get(id: string, signal?: AbortSignal): Promise<BrowserNode | undefined>;
  children(parentId: string | null, signal?: AbortSignal): Promise<readonly BrowserNode[]>;
  subscribe(listener: (change: SourceChange) => void): () => void;
}

export interface BrowserSnapshot {
  readonly activeId: string | null;
  readonly query: string;
  readonly selectedIds: readonly string[];
  readonly expandedIds: readonly string[];
}
