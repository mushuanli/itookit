// @file vfs-ui/core/VFSUIManager.ts
import { VFSCore, VNode } from '@itookit/vfs-core';
import { VFSTreeView } from '../components/VFSTreeView';
import { EditorRegistry } from './EditorRegistry';
import { EventBus } from './EventBus';
import type {
  VFSUIOptions,
  IVFSUIManager,
  VFSUIEvent,
  EventCallback,
  UnsubscribeFn,
  IEditor,
  EditorFactory
} from '../interfaces/IVFSUIManager';

export class VFSUIManager implements IVFSUIManager {
  private vfs: VFSCore;
  private module: string;
  private treeView: VFSTreeView;
  private editorRegistry: EditorRegistry;
  private eventBus: EventBus;
  private currentEditor: IEditor | null = null;
  private currentNode: VNode | null = null;
  private readOnly: boolean;
  
  private containers: {
    sidebar: HTMLElement;
    editor?: HTMLElement;
    outline?: HTMLElement;
  };
  
  private state: {
    expandedFolderIds: Set<string>;
    activeNodeId: string | null;
    sidebarCollapsed: boolean;
  };

  constructor(options: VFSUIOptions) {
    this.vfs = options.vfsCore;
    this.module = options.module;
    this.readOnly = options.readOnly ?? false;
    
    // 初始化容器
    this.containers = {
      sidebar: options.container,
      editor: options.editorContainer,
      outline: options.outlineContainer
    };
    
    // 初始化状态
    this.state = {
      expandedFolderIds: new Set(options.initialState?.expandedFolderIds || []),
      activeNodeId: options.initialState?.activeNodeId || null,
      sidebarCollapsed: false
    };
    
    // 初始化子组件
    this.eventBus = new EventBus();
    this.editorRegistry = new EditorRegistry();
    
    this.treeView = new VFSTreeView({
      container: this.containers.sidebar,
      vfs: this.vfs,
      module: this.module,
      expandedFolderIds: this.state.expandedFolderIds,
      contextMenu: options.contextMenu
    });
    
    // 连接事件
    this._bindVFSEvents();
    this._bindTreeEvents();
  }

  /**
   * 启动 UI 管理器
   */
  async start(): Promise<void> {
    // 初始化文件树
    await this.treeView.init();
    
    // 恢复或选择默认节点
    if (this.state.activeNodeId) {
      try {
        await this.setActiveNode(this.state.activeNodeId);
      } catch (error) {
        console.warn('Failed to restore active node:', error);
        this.state.activeNodeId = null;
      }
    }
    
    // 如果没有活动节点，尝试选择第一个文件
    if (!this.state.activeNodeId) {
      await this._selectFirstFile();
    }
  }

  /**
   * 销毁 UI 管理器
   */
  destroy(): void {
    // 清理编辑器
    if (this.currentEditor) {
      this.currentEditor.destroy();
      this.currentEditor = null;
    }
    
    // 清理文件树
    this.treeView.destroy();
    
    // 清理事件监听
    this.eventBus.clear();
    
    // 保存状态
    this._saveState();
  }

  /**
   * 切换模块
   */
  async setModule(moduleName: string): Promise<void> {
    if (this.module === moduleName) return;
    
    this.module = moduleName;
    
    // 清理当前编辑器
    if (this.currentEditor) {
      this.currentEditor.destroy();
      this.currentEditor = null;
      this.currentNode = null;
    }
    
    // 重新加载文件树
    await this.treeView.setModule(moduleName);
    
    // 选择第一个文件
    await this._selectFirstFile();
    
    this.eventBus.emit('moduleChanged', { module: moduleName });
  }

  /**
   * 获取当前模块
   */
  getCurrentModule(): string {
    return this.module;
  }

  /**
   * 设置活动节点
   */
  async setActiveNode(nodeId: string): Promise<void> {
    const node = await this.vfs.getNode(nodeId);
    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }
    
    // 如果是目录，展开/折叠
    if (node.isDirectory()) {
      this.treeView.toggleNode(nodeId);
      return;
    }
    
    // 清理旧编辑器
    if (this.currentEditor) {
      this.currentEditor.destroy();
      this.currentEditor = null;
    }
    
    // 创建新编辑器
    if (this.containers.editor) {
      try {
        const adapter = this.editorRegistry.getAdapter(node);
        this.currentEditor = await adapter.createEditor(
          this.containers.editor,
          node
        );
        
        this.currentNode = node;
        this.state.activeNodeId = nodeId;
        
        // 更新 UI
        this.treeView.selectNode(nodeId);
        
        // 更新大纲
        if (this.containers.outline) {
          await this._updateOutline(node);
        }
        
        // 保存状态
        this._saveState();
        
        // 触发事件
        this.eventBus.emit('nodeSelected', { node });
        
      } catch (error) {
        console.error('Failed to create editor:', error);
        throw error;
      }
    }
  }

  /**
   * 获取活动节点
   */
  getActiveNode(): VNode | null {
    return this.currentNode;
  }

  /**
   * 刷新文件树
   */
  async refreshTree(): Promise<void> {
    await this.treeView.refresh();
  }

  /**
   * 注册编辑器
   */
  registerEditor(
    contentType: string,
    factory: EditorFactory
  ): void {
    this.editorRegistry.registerEditor(contentType, factory, this.vfs);
  }

  /**
   * 获取活动编辑器
   */
  getActiveEditor(): IEditor | null {
    return this.currentEditor;
  }

  /**
   * 事件订阅
   */
  on(event: VFSUIEvent, callback: EventCallback): UnsubscribeFn {
    return this.eventBus.on(event, callback);
  }

  /**
   * 切换侧边栏显示/隐藏
   */
  toggleSidebar(): void {
    this.state.sidebarCollapsed = !this.state.sidebarCollapsed;
    this.containers.sidebar.classList.toggle('collapsed', this.state.sidebarCollapsed);
    this.eventBus.emit('sidebarToggled', { collapsed: this.state.sidebarCollapsed });
  }

  /**
   * 设置标题
   */
  setTitle(title: string): void {
    const titleElement = this.containers.sidebar.querySelector('.vfs-ui-title');
    if (titleElement) {
      titleElement.textContent = title;
    }
  }

  /**
   * 绑定 VFS 核心事件
   */
  private _bindVFSEvents(): void {
    this.vfs.on('vnode:created', ({ vnode }) => {
      if (vnode.module === this.module) {
        this.treeView.refresh();
        this.eventBus.emit('nodeCreated', { node: vnode });
      }
    });

    this.vfs.on('vnode:updated', ({ vnode }) => {
      if (vnode.module === this.module) {
        // 如果是当前编辑的节点，重新加载
        if (vnode.id === this.currentNode?.id) {
          this._reloadEditor();
        }
        this.treeView.refresh();
      }
    });

    this.vfs.on('vnode:deleted', ({ vnode }) => {
      if (vnode.module === this.module) {
        // 如果删除的是当前节点，清理编辑器
        if (vnode.id === this.currentNode?.id) {
          if (this.currentEditor) {
            this.currentEditor.destroy();
            this.currentEditor = null;
          }
          this.currentNode = null;
          this.state.activeNodeId = null;
        }
        
        this.treeView.refresh();
        this.eventBus.emit('nodeDeleted', { node: vnode });
      }
    });
  }

  /**
   * 绑定文件树事件
   */
  private _bindTreeEvents(): void {
    this.treeView.on('nodeClick', async ({ nodeId }) => {
      try {
        await this.setActiveNode(nodeId);
      } catch (error) {
        console.error('Failed to activate node:', error);
      }
    });

    this.treeView.on('nodeExpand', ({ nodeId }) => {
      this.state.expandedFolderIds.add(nodeId);
      this._saveState();
    });

    this.treeView.on('nodeCollapse', ({ nodeId }) => {
      this.state.expandedFolderIds.delete(nodeId);
      this._saveState();
    });
  }

  /**
   * 重新加载编辑器
   */
  private async _reloadEditor(): Promise<void> {
    if (!this.currentNode || !this.currentEditor) return;
    
    try {
      const adapter = this.editorRegistry.getAdapter(this.currentNode);
      const content = await adapter.loadContent(this.currentNode);
      this.currentEditor.setContent(content.raw);
    } catch (error) {
      console.error('Failed to reload editor:', error);
    }
  }

  /**
   * 更新大纲
   */
  private async _updateOutline(node: VNode): Promise<void> {
    if (!this.containers.outline) return;
    
    try {
      const adapter = this.editorRegistry.getAdapter(node);
      const metadata = await adapter.getMetadata(node);
      
      if (metadata.headings && metadata.headings.length > 0) {
        this.containers.outline.innerHTML = this._renderOutline(metadata.headings);
      } else {
        this.containers.outline.innerHTML = '<div class="no-outline">No outline available</div>';
      }
    } catch (error) {
      console.error('Failed to update outline:', error);
      this.containers.outline.innerHTML = '<div class="outline-error">Error loading outline</div>';
    }
  }

  /**
   * 渲染大纲
   */
  private _renderOutline(headings: any[]): string {
    return `
      <div class="vfs-outline">
        ${headings.map(h => `
          <div class="outline-item level-${h.level}" data-line="${h.line}">
            ${h.text}
          </div>
        `).join('')}
      </div>
    `;
  }

  /**
   * 选择第一个文件
   */
  private async _selectFirstFile(): Promise<void> {
    const tree = await this.vfs.getTree(this.module);
    const firstFile = this._findFirstFile(tree);
    
    if (firstFile) {
      await this.setActiveNode(firstFile.id);
    }
  }

  /**
   * 查找第一个文件
   */
  private _findFirstFile(nodes: VNode[]): VNode | null {
    for (const node of nodes) {
      if (node.type === 'file') {
        return node;
      }
      if (node.isDirectory() && node.children) {
        const found = this._findFirstFile(node.children);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * 保存状态
   */
  private _saveState(): void {
    const state = {
      module: this.module,
      expandedFolderIds: Array.from(this.state.expandedFolderIds),
      activeNodeId: this.state.activeNodeId,
      sidebarCollapsed: this.state.sidebarCollapsed
    };
    
    localStorage.setItem('vfs-ui-state', JSON.stringify(state));
  }

  /**
   * 加载状态
   */
  private _loadState(): any {
    try {
      const saved = localStorage.getItem('vfs-ui-state');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  }
}
