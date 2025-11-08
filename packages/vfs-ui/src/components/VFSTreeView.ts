/**
 * @file vfs-ui/components/VFSTreeView.ts
 */
import { VFSCore, VNode } from '@itookit/vfs-core';
import { EventBus } from '../core/EventBus';
import type { FilterCriteria, ContextMenuConfig } from '../interfaces';

interface VFSTreeViewOptions {
  container: HTMLElement;
  vfs: VFSCore;
  module: string;
  expandedFolderIds?: Set<string>;
  contextMenu?: ContextMenuConfig;
}

interface TreeState {
  nodes: VNode[];
  expandedIds: Set<string>;
  selectedId: string | null;
  filter: FilterCriteria | null;
}

export class VFSTreeView {
  private container: HTMLElement;
  private vfs: VFSCore;
  private module: string;
  private eventBus: EventBus;
  private state: TreeState;
  private contextMenuConfig?: ContextMenuConfig;

  constructor(options: VFSTreeViewOptions) {
    this.container = options.container;
    this.vfs = options.vfs;
    this.module = options.module;
    this.contextMenuConfig = options.contextMenu;
    
    this.state = {
      nodes: [],
      expandedIds: options.expandedFolderIds || new Set(),
      selectedId: null,
      filter: null
    };
    
    this.eventBus = new EventBus();
  }

  /**
   * 初始化
   */
  async init(): Promise<void> {
    await this.loadTree();
    this._bindEvents();
    this.render();
  }

  /**
   * 销毁
   */
  destroy(): void {
    this.eventBus.clear();
    this.container.innerHTML = '';
  }

  /**
   * 设置模块
   */
  async setModule(moduleName: string): Promise<void> {
    this.module = moduleName;
    this.state.selectedId = null;
    this.state.expandedIds.clear();
    await this.loadTree();
  }

  /**
   * 加载文件树
   */
  async loadTree(): Promise<void> {
    try {
      const tree = await this.vfs.getTree(this.module);
      this.state.nodes = this._applyFilter(tree);
      this.render();
    } catch (error) {
      console.error('Failed to load tree:', error);
      this._renderError('Failed to load file tree');
    }
  }

  /**
   * 刷新文件树
   */
  async refresh(): Promise<void> {
    await this.loadTree();
  }

  /**
   * 展开节点
   */
  expandNode(nodeId: string): void {
    this.state.expandedIds.add(nodeId);
    this.render();
    this.eventBus.emit('nodeExpand', { nodeId });
  }

  /**
   * 折叠节点
   */
  collapseNode(nodeId: string): void {
    this.state.expandedIds.delete(nodeId);
    this.render();
    this.eventBus.emit('nodeCollapse', { nodeId });
  }

  /**
   * 切换节点展开/折叠
   */
  toggleNode(nodeId: string): void {
    if (this.state.expandedIds.has(nodeId)) {
      this.collapseNode(nodeId);
    } else {
      this.expandNode(nodeId);
    }
  }

  /**
   * 选择节点
   */
  selectNode(nodeId: string): void {
    this.state.selectedId = nodeId;
    this.render();
  }

  /**
   * 设置过滤条件
   */
  setFilter(criteria: FilterCriteria): void {
    this.state.filter = criteria;
    this.state.nodes = this._applyFilter(this.state.nodes);
    this.render();
  }

  /**
   * 清除过滤
   */
  clearFilter(): void {
    this.state.filter = null;
    this.loadTree();
  }

  /**
   * 订阅事件
   */
  on(event: string, callback: (data: any) => void): () => void {
    return this.eventBus.on(event, callback);
  }

  /**
   * 应用过滤条件
   */
  private _applyFilter(nodes: VNode[]): VNode[] {
    if (!this.state.filter) return nodes;

    const { query, contentType, tags, type } = this.state.filter;

    const filterNode = (node: VNode): VNode | null => {
      // 类型过滤
      if (type && node.type !== type) {
        if (node.isDirectory() && node.children) {
          const filteredChildren = node.children
            .map(filterNode)
            .filter(Boolean) as VNode[];
          
          if (filteredChildren.length > 0) {
            return { ...node, children: filteredChildren };
          }
        }
        return null;
      }

      // 内容类型过滤
      if (contentType && node.contentType !== contentType) {
        return null;
      }

      // 标签过滤
      if (tags && tags.length > 0) {
        const nodeTags = node.meta.tags || [];
        if (!tags.every(t => nodeTags.includes(t))) {
          return null;
        }
      }

      // 文本搜索
      if (query) {
        const searchText = [
          node.name,
          node.meta.tags?.join(' '),
          node.meta.summary
        ].join(' ').toLowerCase();

        if (!searchText.includes(query.toLowerCase())) {
          // 如果是目录，检查子节点
          if (node.isDirectory() && node.children) {
            const filteredChildren = node.children
              .map(filterNode)
              .filter(Boolean) as VNode[];
            
            if (filteredChildren.length > 0) {
              return { ...node, children: filteredChildren };
            }
          }
          return null;
        }
      }

      // 如果是目录，递归过滤子节点
      if (node.isDirectory() && node.children) {
        const filteredChildren = node.children
          .map(filterNode)
          .filter(Boolean) as VNode[];
        return { ...node, children: filteredChildren };
      }

      return node;
    };

    return nodes.map(filterNode).filter(Boolean) as VNode[];
  }

  /**
   * 渲染
   */
  render(): void {
    const html = `
      <div class="vfs-tree-view">
        <div class="tree-toolbar">
          <input 
            type="text" 
            class="tree-search" 
            placeholder="Search files..."
            value="${this.state.filter?.query || ''}"
          />
        </div>
        <div class="tree-content">
          ${this._renderNodes(this.state.nodes, 0)}
        </div>
      </div>
    `;
    
    this.container.innerHTML = html;
  }

  /**
   * 渲染节点列表
   */
  private _renderNodes(nodes: VNode[], level: number): string {
    return nodes.map(node => {
      if (node.isDirectory()) {
        return this._renderFolder(node, level);
      } else {
        return this._renderFile(node, level);
      }
    }).join('');
  }

  /**
   * 渲染文件夹
   */
  private _renderFolder(node: VNode, level: number): string {
    const isExpanded = this.state.expandedIds.has(node.id);
    const isSelected = this.state.selectedId === node.id;
    const hasChildren = node.children && node.children.length > 0;
    
    const childrenHtml = isExpanded && hasChildren
      ? this._renderNodes(node.children, level + 1)
      : '';

    return `
      <div class="tree-folder ${isExpanded ? 'expanded' : ''}" 
           data-node-id="${node.id}"
           data-level="${level}">
        <div class="tree-folder-header ${isSelected ? 'selected' : ''}"
             style="padding-left: ${level * 16}px">
          <span class="folder-icon">${isExpanded ? '📂' : '📁'}</span>
          <span class="folder-name">${this._escapeHtml(node.name)}</span>
          ${hasChildren ? `<span class="folder-count">(${node.children.length})</span>` : ''}
        </div>
        ${childrenHtml ? `<div class="tree-folder-children">${childrenHtml}</div>` : ''}
      </div>
    `;
  }

  /**
   * 渲染文件
   */
  private _renderFile(node: VNode, level: number): string {
    const isSelected = this.state.selectedId === node.id;
    const icon = this._getFileIcon(node);
    const meta = this._getFileMeta(node);

    return `
      <div class="tree-item ${isSelected ? 'selected' : ''}"
           data-node-id="${node.id}"
           data-type="file"
           data-level="${level}"
           style="padding-left: ${(level + 1) * 16}px">
        <span class="file-icon">${icon}</span>
        <span class="file-name">${this._escapeHtml(node.name)}</span>
        ${meta ? `<span class="file-meta">${meta}</span>` : ''}
      </div>
    `;
  }

  /**
   * 获取文件图标
   */
  private _getFileIcon(node: VNode): string {
    const iconMap: Record<string, string> = {
      'markdown': '📝',
      'text/markdown': '📝',
      'text/plain': '📄',
      'agent': '🤖',
      'task': '✓',
      'application/json': '📋',
      'srs': '🎯'
    };
    return iconMap[node.contentType] || '📄';
  }

  /**
   * 获取文件元信息
   */
  private _getFileMeta(node: VNode): string {
    const parts: string[] = [];

    // 标签
    if (node.meta.tags && node.meta.tags.length > 0) {
      parts.push(`🏷️ ${node.meta.tags.slice(0, 2).join(', ')}`);
    }

    // 修改时间
    if (node.updatedAt) {
      const date = new Date(node.updatedAt);
      const now = new Date();
      const diff = now.getTime() - date.getTime();
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      
      if (days === 0) {
        parts.push('Today');
      } else if (days === 1) {
        parts.push('Yesterday');
      } else if (days < 7) {
        parts.push(`${days}d ago`);
      }
    }

    return parts.join(' · ');
  }

  /**
   * 渲染错误
   */
  private _renderError(message: string): void {
    this.container.innerHTML = `
      <div class="vfs-tree-error">
        <span class="error-icon">⚠️</span>
        <span class="error-message">${this._escapeHtml(message)}</span>
      </div>
    `;
  }

  /**
   * 绑定事件
   */
  private _bindEvents(): void {
    // 使用事件委托
    this.container.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      
      // 点击文件夹
      const folderHeader = target.closest('.tree-folder-header');
      if (folderHeader) {
        const folder = folderHeader.closest('.tree-folder') as HTMLElement;
        const nodeId = folder.dataset.nodeId!;
        this.toggleNode(nodeId);
        this.eventBus.emit('folderClick', { nodeId });
        return;
      }
      
      // 点击文件
      const fileItem = target.closest('.tree-item');
      if (fileItem) {
        const nodeId = (fileItem as HTMLElement).dataset.nodeId!;
        this.selectNode(nodeId);
        this.eventBus.emit('nodeClick', { nodeId });
        return;
      }
    });

    // 搜索输入
    this.container.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      if (target.classList.contains('tree-search')) {
        const query = target.value.trim();
        if (query) {
          this.setFilter({ query });
        } else {
          this.clearFilter();
        }
      }
    });

    // 右键菜单
    if (this.contextMenuConfig) {
      this.container.addEventListener('contextmenu', (e) => {
        const target = e.target as HTMLElement;
        const item = target.closest('.tree-item, .tree-folder-header');
        
        if (item) {
          e.preventDefault();
          const nodeId = (item.closest('[data-node-id]') as HTMLElement).dataset.nodeId!;
          this._showContextMenu(e, nodeId);
        }
      });
    }
  }

  /**
   * 显示右键菜单
   */
  private _showContextMenu(e: MouseEvent, nodeId: string): void {
    // 这里应该调用应用层的上下文菜单组件
    this.eventBus.emit('contextMenu', {
      nodeId,
      x: e.clientX,
      y: e.clientY
    });
  }

  /**
   * HTML 转义
   */
  private _escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
