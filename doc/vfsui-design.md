# VFS-UI 重构设计方案

## 一、架构概览

将 sidebar 重构为 **vfs-ui**，作为 vfs-core 的通用呈现层，支持多种内容类型和编辑器。

```
┌─────────────────────────────────────────────────────┐
│                   Application                        │
└────────────────┬────────────────────────────────────┘
                 │
    ┌────────────┴────────────┐
    │                         │
┌───▼──────┐          ┌──────▼─────┐
│  vfs-ui  │◄────────►│  vfs-core  │
│ (呈现层)  │          │  (数据层)   │
└────┬─────┘          └────────────┘
     │
┌────▼────────────────────────┐
│   IEditor Implementations    │
│  (Markdown, Chat, Code...)   │
└──────────────────────────────┘
```

## 二、核心接口设计

### 1. IVFSUIManager (主管理器接口)

```typescript
interface VFSUIOptions {
  container: HTMLElement;
  vfsCore: VFSCore;
  module: string;
  readOnly?: boolean;
  initialState?: {
    expandedFolderIds?: string[];
    activeNodeId?: string;
  };
  editorContainer?: HTMLElement;
  outlineContainer?: HTMLElement;
  contextMenu?: ContextMenuConfig;
}

interface IVFSUIManager {
  // 生命周期
  start(): Promise<void>;
  destroy(): void;

  // 模块管理
  setModule(moduleName: string): Promise<void>;
  getCurrentModule(): string;

  // 节点操作
  setActiveNode(nodeId: string): Promise<void>;
  getActiveNode(): VNode | null;
  refreshTree(): Promise<void>;

  // 编辑器管理
  registerEditor(
    contentType: string, 
    factory: EditorFactory
  ): void;
  getActiveEditor(): IEditor | null;

  // 事件订阅
  on(event: VFSUIEvent, callback: EventCallback): UnsubscribeFn;

  // UI 控制
  toggleSidebar(): void;
  setTitle(title: string): void;
}

type VFSUIEvent = 
  | 'nodeSelected'
  | 'nodeCreated'
  | 'nodeDeleted'
  | 'editorChanged'
  | 'sidebarToggled';

type EditorFactory = (
  container: HTMLElement,
  node: VNode,
  options: any
) => IEditor;
```

### 2. VFSTreeView (文件树组件)

```typescript
interface IVFSTreeView {
  render(): void;
  expandNode(nodeId: string): void;
  collapseNode(nodeId: string): void;
  selectNode(nodeId: string): void;
  refresh(): Promise<void>;

  // 过滤和搜索
  setFilter(criteria: FilterCriteria): void;
  clearFilter(): void;
}

interface FilterCriteria {
  query?: string;
  contentType?: string;
  tags?: string[];
  type?: 'file' | 'directory';
}
```

### 3. ContentViewAdapter (内容视图适配器)

```typescript
interface IContentViewAdapter {
  // 检查是否能处理此节点
  canHandle(node: VNode): boolean;

  // 创建编辑器实例
  createEditor(
    container: HTMLElement,
    node: VNode
  ): Promise<IEditor>;

  // 加载内容
  loadContent(node: VNode): Promise<EditorContent>;

  // 保存内容
  saveContent(
    node: VNode,
    content: string
  ): Promise<void>;

  // 获取元数据（用于大纲等）
  getMetadata(node: VNode): Promise<ContentMetadata>;
}

interface EditorContent {
  raw: string;
  formatted?: any;
  metadata?: ContentMetadata;
}

interface ContentMetadata {
  headings?: Heading[];
  summary?: string;
  stats?: {
    wordCount?: number;
    clozeCount?: number;
    taskCount?: number;
  };
}
```

## 三、核心类实现

### 1. VFSUIManager

```typescript
class VFSUIManager implements IVFSUIManager {
  private vfs: VFSCore;
  private module: string;
  private treeView: VFSTreeView;
  private editorRegistry: EditorRegistry;
  private activeAdapter: IContentViewAdapter | null;
  private currentEditor: IEditor | null;

  constructor(options: VFSUIOptions) {
    this.vfs = options.vfsCore;
    this.module = options.module;
  
    // 初始化子组件
    this.treeView = new VFSTreeView({
      container: options.container,
      vfs: this.vfs,
      module: this.module
    });
  
    this.editorRegistry = new EditorRegistry();
  
    // 连接事件
    this._bindVFSEvents();
    this._bindTreeEvents();
  }

  async start(): Promise<void> {
    await this.treeView.init();
  
    // 恢复或选择默认节点
    const savedNodeId = this._loadState()?.activeNodeId;
    if (savedNodeId) {
      await this.setActiveNode(savedNodeId);
    }
  }

  async setActiveNode(nodeId: string): Promise<void> {
    const node = await this.vfs.getNode(nodeId);
    if (!node) throw new Error(`Node not found: ${nodeId}`);
  
    // 清理旧编辑器
    this.currentEditor?.destroy();
  
    // 创建新编辑器
    const adapter = this.editorRegistry.getAdapter(node);
    this.activeAdapter = adapter;
    this.currentEditor = await adapter.createEditor(
      this.editorContainer,
      node
    );
  
    // 更新 UI
    this.treeView.selectNode(nodeId);
    this._saveState({ activeNodeId: nodeId });
  
    this.emit('nodeSelected', { node });
  }

  registerEditor(
    contentType: string,
    factory: EditorFactory
  ): void {
    const adapter = new GenericContentAdapter(
      contentType,
      factory,
      this.vfs
    );
    this.editorRegistry.register(contentType, adapter);
  }

  private _bindVFSEvents(): void {
    // 监听 vfs-core 事件
    this.vfs.on('vnode:created', ({ vnode }) => {
      if (vnode.module === this.module) {
        this.treeView.refresh();
      }
    });
  
    this.vfs.on('vnode:updated', ({ vnode }) => {
      if (vnode.module === this.module) {
        if (vnode.id === this.currentNode?.id) {
          this._reloadEditor();
        }
      }
    });
  
    this.vfs.on('vnode:deleted', ({ vnode }) => {
      if (vnode.id === this.currentNode?.id) {
        this.currentEditor?.destroy();
        this.currentEditor = null;
      }
      this.treeView.refresh();
    });
  }
}
```

### 2. EditorRegistry (编辑器注册表)

```typescript
class EditorRegistry {
  private adapters: Map<string, IContentViewAdapter>;
  private fallbackAdapter: IContentViewAdapter;

  constructor() {
    this.adapters = new Map();
    this.fallbackAdapter = new PlainTextAdapter();
  }

  register(
    contentType: string,
    adapter: IContentViewAdapter
  ): void {
    this.adapters.set(contentType, adapter);
  }

  getAdapter(node: VNode): IContentViewAdapter {
    // 1. 精确匹配
    const exact = this.adapters.get(node.contentType);
    if (exact?.canHandle(node)) return exact;
  
    // 2. 模糊匹配（如 text/* 匹配 text/markdown）
    for (const [pattern, adapter] of this.adapters) {
      if (this._matchContentType(pattern, node.contentType)) {
        if (adapter.canHandle(node)) return adapter;
      }
    }
  
    // 3. 回退到通用适配器
    return this.fallbackAdapter;
  }

  private _matchContentType(
    pattern: string,
    actual: string
  ): boolean {
    if (pattern.includes('*')) {
      const regex = new RegExp(
        '^' + pattern.replace('*', '.*') + '$'
      );
      return regex.test(actual);
    }
    return pattern === actual;
  }
}
```

### 3. GenericContentAdapter (通用适配器)

```typescript
class GenericContentAdapter implements IContentViewAdapter {
  constructor(
    private contentType: string,
    private editorFactory: EditorFactory,
    private vfs: VFSCore
  ) {}

  canHandle(node: VNode): boolean {
    return node.contentType === this.contentType;
  }

  async createEditor(
    container: HTMLElement,
    node: VNode
  ): Promise<IEditor> {
    const content = await this.loadContent(node);
  
    const editor = this.editorFactory(container, node, {
      initialContent: content.raw
    });
  
    // 绑定保存事件
    editor.on('change', debounce(async () => {
      await this.saveContent(node, editor.getText());
    }, 500));
  
    return editor;
  }

  async loadContent(node: VNode): Promise<EditorContent> {
    const { content, metadata } = await this.vfs.read(node.id);
  
    return {
      raw: content,
      metadata: {
        headings: metadata.headings,
        summary: metadata.summary,
        stats: {
          clozeCount: metadata.clozes?.length,
          taskCount: metadata.tasks?.length
        }
      }
    };
  }

  async saveContent(
    node: VNode,
    content: string
  ): Promise<void> {
    await this.vfs.write(node.id, content);
  }

  async getMetadata(node: VNode): Promise<ContentMetadata> {
    const { metadata } = await this.vfs.read(node.id);
    return {
      headings: metadata.headings || [],
      summary: metadata.summary,
      stats: metadata
    };
  }
}
```

### 4. VFSTreeView (文件树视图)

```typescript
class VFSTreeView extends BaseComponent {
  private vfs: VFSCore;
  private module: string;
  private filterCriteria: FilterCriteria | null;

  async init(): Promise<void> {
    await this.loadTree();
    this._bindEvents();
  }

  async loadTree(): Promise<void> {
    const tree = await this.vfs.getTree(this.module);
    this.state.nodes = this._applyFilter(tree);
    this.render();
  }

  private _applyFilter(nodes: VNode[]): VNode[] {
    if (!this.filterCriteria) return nodes;
  
    const { query, contentType, tags, type } = this.filterCriteria;
  
    return nodes.filter(node => {
      // 类型过滤
      if (type && node.type !== type) return false;
    
      // 内容类型过滤
      if (contentType && node.contentType !== contentType) {
        return false;
      }
    
      // 标签过滤
      if (tags && tags.length > 0) {
        const nodeTags = node.meta.tags || [];
        if (!tags.every(t => nodeTags.includes(t))) {
          return false;
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
          return false;
        }
      }
    
      return true;
    });
  }

  render(): void {
    this.container.innerHTML = this._renderNodes(
      this.state.nodes
    );
  }

  private _renderNodes(nodes: VNode[]): string {
    return nodes.map(node => {
      const isExpanded = this.state.expandedIds.has(node.id);
      const isSelected = this.state.selectedId === node.id;
    
      if (node.isDirectory()) {
        return this._renderFolder(node, isExpanded, isSelected);
      } else {
        return this._renderFile(node, isSelected);
      }
    }).join('');
  }

  private _renderFile(node: VNode, isSelected: boolean): string {
    const icon = this._getFileIcon(node);
    const meta = this._getFileMeta(node);
  
    return `
      <div class="vfs-tree-item ${isSelected ? 'selected' : ''}"
           data-node-id="${node.id}"
           data-type="file">
        <span class="icon">${icon}</span>
        <span class="name">${node.name}</span>
        ${meta ? `<span class="meta">${meta}</span>` : ''}
      </div>
    `;
  }

  private _getFileIcon(node: VNode): string {
    const iconMap: Record<string, string> = {
      'markdown': '📝',
      'text/plain': '📄',
      'agent': '🤖',
      'task': '✓'
    };
    return iconMap[node.contentType] || '📄';
  }
}
```

## 四、使用示例

### 1. 基础使用

```typescript
import { getVFSManager } from '@itookit/vfs-core';
import { VFSUIManager } from '@itookit/vfs-ui';
import { MarkdownEditor } from './editors/MarkdownEditor';

// 初始化 vfs-core
const vfs = getVFSManager();
await vfs.init();
await vfs.mount('notes');

// 创建 vfs-ui
const ui = new VFSUIManager({
  container: document.querySelector('#sidebar'),
  editorContainer: document.querySelector('#editor'),
  vfsCore: vfs,
  module: 'notes'
});

// 注册 Markdown 编辑器
ui.registerEditor('markdown', (container, node, options) => {
  return new MarkdownEditor(container, {
    initialContent: options.initialContent
  });
});

// 启动
await ui.start();

// 监听事件
ui.on('nodeSelected', ({ node }) => {
  console.log('Selected:', node.name);
});
```

### 2. 多内容类型支持

```typescript
// 注册多种编辑器
ui.registerEditor('markdown', MarkdownEditorFactory);
ui.registerEditor('agent', AgentEditorFactory);
ui.registerEditor('application/json', JsonEditorFactory);

// 通配符匹配
ui.registerEditor('text/*', PlainTextEditorFactory);
```

### 3. 自定义内容适配器

```typescript
class CustomAdapter implements IContentViewAdapter {
  canHandle(node: VNode): boolean {
    return node.contentType === 'custom/format';
  }

  async createEditor(container, node) {
    // 自定义加载逻辑
    const data = await this.loadCustomFormat(node);
    return new CustomEditor(container, data);
  }

  async getMetadata(node: VNode) {
    // 提供自定义元数据
    return {
      headings: await this.extractHeadings(node),
      summary: await this.generateSummary(node)
    };
  }
}

ui.editorRegistry.register('custom/format', new CustomAdapter());
```

```js
// 在注册时，用户需要提供编辑器工厂：

// 示例：使用 CodeMirror
editorRegistry.register('text/markdown', (container, node, options) => {
  const editor = new CodeMirrorEditor(container, {
    initialContent: options?.initialContent,
    mode: 'markdown'
  });
  
  return {
    getText: () => editor.getValue(),
    setContent: (content) => editor.setValue(content),
    getSelection: () => editor.getSelection(),
    insert: (text, pos) => editor.replaceRange(text, pos),
    focus: () => editor.focus(),
    goToLine: (line) => editor.setCursor(line, 0),
    on: (event, callback) => editor.on(event, callback),
    destroy: () => editor.toTextArea()
  };
});

// 示例：使用简单的 textarea
editorRegistry.register('text/plain', (container, node, options) => {
  const textarea = document.createElement('textarea');
  textarea.value = options?.initialContent || '';
  container.appendChild(textarea);
  
  const listeners = new Map();
  
  return {
    getText: () => textarea.value,
    setContent: (content) => { textarea.value = content; },
    getSelection: () => textarea.value.substring(
      textarea.selectionStart, 
      textarea.selectionEnd
    ),
    insert: (text, pos) => {
      const value = textarea.value;
      const insertPos = pos ?? textarea.selectionStart;
      textarea.value = value.slice(0, insertPos) + text + value.slice(insertPos);
    },
    focus: () => textarea.focus(),
    goToLine: (line) => {
      const lines = textarea.value.split('\n');
      const pos = lines.slice(0, line - 1).join('\n').length;
      textarea.setSelectionRange(pos, pos);
    },
    on: (event, callback) => {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(callback);
      
      if (event === 'change') {
        textarea.addEventListener('input', callback);
      }
      
      return () => {
        const cbs = listeners.get(event);
        const idx = cbs?.indexOf(callback);
        if (idx !== -1) cbs?.splice(idx, 1);
      };
    },
    destroy: () => {
      textarea.remove();
    }
  };
});

```

## 五、迁移策略

### 从旧 sidebar 迁移

```typescript
// 旧代码
const sessionUI = createSessionUI(options, configManager, namespace);

// 新代码
const vfsUI = new VFSUIManager({
  container: options.sessionListContainer,
  editorContainer: options.editorContainer,
  vfsCore: vfs, // 替代 configManager
  module: namespace
});

// API 映射
sessionUI.getActiveSession() 
  → vfsUI.getActiveNode()

sessionUI.updateSessionContent(id, content)
  → vfsUI.getActiveEditor()?.setText(content)

sessionUI.on('sessionSelected', callback)
  → vfsUI.on('nodeSelected', callback)
```

## 六、优势总结

1. **解耦合**: UI 层不依赖具体数据结构
2. **可扩展**: 轻松支持新的内容类型
3. **可复用**: 同一套 UI 适配多种场景
4. **类型安全**: 完整的 TypeScript 支持
5. **易维护**: 清晰的职责分离
6. **向后兼容**: 通过适配器模式平滑迁移

## 七、文件结构

```
vfs-ui/
├── core/
│   ├── VFSUIManager.ts      # 主管理器
│   ├── EditorRegistry.ts    # 编辑器注册表
│   └── EventBus.ts           # 事件总线
├── components/
│   ├── VFSTreeView.ts        # 文件树组件
│   ├── VFSOutline.ts         # 大纲组件
│   └── VFSToolbar.ts         # 工具栏
├── adapters/
│   ├── IContentViewAdapter.ts        # 适配器接口
│   ├── GenericContentAdapter.ts     # 通用适配器
│   ├── MarkdownAdapter.ts           # Markdown 适配器
│   └── PlainTextAdapter.ts          # 纯文本适配器
├── interfaces/
│   └── IVFSUIManager.ts      # 公共接口
├── utils/
│   └── helpers.ts            # 工具函数
└── index.ts                  # 导出入口
```

---

这个方案将 sidebar 成功重构为通用的 vfs-ui，支持多种内容类型，易于扩展和维护。