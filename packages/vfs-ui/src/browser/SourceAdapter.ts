import { fileTypeIcon } from '@itookit/common';
import { RefreshScheduler } from '../services/RefreshScheduler';
import type { BrowserNode, BrowserSource } from '../contracts/source';
import type { IStatePort } from '../contracts/ports';
import type { VFSNodeUI } from '../contracts/types';
import { getExtension, findNodeById } from '../utils/helpers';

export function displayNode(node: BrowserNode): VFSNodeUI {
  return { id: node.id, type: node.kind === 'file' ? 'file' : 'directory', version: '1', icon: node.icon || fileTypeIcon(node.resource?.path ?? node.label, node.kind !== 'file'),
    presentation: { fileDetails: node.fileDetails },
    resource: node.resource, kind: node.kind, parentId: node.parentId,
    metadata: { title: node.label, size: node.size, path: node.resource?.path ?? '', parentPath: node.parentId,
      tags: [...node.tags ?? []], createdAt: new Date(node.createdAt ?? 0).toISOString(), lastModified: new Date(node.modifiedAt ?? 0).toISOString(),
      custom: { _extension: node.resource && node.kind === 'file' ? getExtension(node.resource.path) : '', _readOnly: node.readOnly, browserPresentation: node.presentation, browserExpandable: node.expandable, navigationMenu: true } },
    content: { format: 'text/plain', data: undefined, summary: node.description ?? '', searchableText: node.description ?? '' },
    children: node.expandable === false ? [] : undefined };
}

/** Shared loading boundary; canceled or stale reads never overwrite newer state. */
export class SourceAdapter {
  private readonly abort = new AbortController();
  private unsubscribe?: () => void;
  private revision = 0;
  private visible = true;
  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible; ++this.revision;
    this.refreshes.setVisible(visible);
  }
  private readonly refreshes: RefreshScheduler;
  constructor(readonly source: BrowserSource, private readonly store: IStatePort, private readonly report?: (error: unknown) => void) {
    this.refreshes = new RefreshScheduler(() => this.loadData({ silent: true }), error => {
      if (!this.abort.signal.aborted) {
        this.store.dispatch({ type: 'ITEMS_LOAD_ERROR', payload: { error } }); this.report?.(error);
      }
    });
  }
  connectEngineEvents(): () => void {
    this.unsubscribe = this.source.subscribe(() => this.refreshes.request());
    return () => this.unsubscribe?.();
  }
  async loadData(_options: { silent?: boolean } = {}): Promise<void> {
    if (!this.visible) return;
    const revision = ++this.revision;
    const items = (await this.source.children(null, this.abort.signal)).map(displayNode);
    if (this.abort.signal.aborted || revision !== this.revision) return;
    this.store.dispatch({ type: 'STATE_LOAD_SUCCESS', payload: { items, tags: new Map() } });
    await this.restoreExpansion(this.store.getState().expandedFolderIds);
  }
  async expandDirectory(id: string, options: { expand?: boolean; restoreDescendants?: boolean } = {}): Promise<void> {
    if (!this.visible) return;
    const revision = this.revision;
    const children = (await this.source.children(id, this.abort.signal)).filter(node => node.id !== id).map(displayNode);
    if (this.abort.signal.aborted || revision !== this.revision) return;
    this.store.dispatch({ type: 'FOLDER_CHILDREN_LOADED', payload: { parentPath: id, children, expand: options.expand } });
  }
  async restoreExpansion(ids: Set<string>): Promise<void> {
    const revision = this.revision;
    const pending = new Set(ids);
    let changed = true;
    while (changed && pending.size && this.visible && revision === this.revision && !this.abort.signal.aborted) {
      changed = false;
      for (const id of pending) {
        if (!this.visible || revision !== this.revision) return;
        const node = findNodeById(this.store.getState().items, id);
        if (!node) continue;
        pending.delete(id); changed = true;
        if (node.children === undefined) await this.expandDirectory(id, { expand: false });
      }
    }
  }

  async reveal(id: string): Promise<void> {
    if (!this.visible) return;
    const revision = this.revision;
    const ancestors: string[] = [], visited = new Set<string>();
    let node = await this.source.get(id, this.abort.signal);
    if (!node) throw new Error('Resource not found: ' + id);
    while (node.parentId) {
      if (!this.visible || revision !== this.revision) return;
      if (visited.has(node.parentId)) throw new Error('Cyclic browser hierarchy');
      visited.add(node.parentId); ancestors.unshift(node.parentId);
      node = await this.source.get(node.parentId, this.abort.signal);
      if (!node) throw new Error('Browser parent not found');
    }
    for (const parent of ancestors) {
      if (!this.visible || revision !== this.revision) return;
      await this.expandDirectory(parent);
    }
  }
  destroy(): void { this.refreshes.destroy(); this.abort.abort(); ++this.revision; this.unsubscribe?.(); }
}
