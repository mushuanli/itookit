<think>

用户希望将整个库重命名为 VFSCore（Virtual File System Manager），并要求我输出指导重构的设计方案和重构计划。

基于之前的分析，我需要：
1. 提供一个完整的 VFS（虚拟文件系统）设计方案
2. 制定详细的重构计划
3. 考虑向后兼容性
4. 提供清晰的实施步骤

让我设计一个类似 Linux VFS 的架构：
- VFS Layer：统一的文件系统接口
- Content Provider：类似 device driver
- Inode：元数据
- Dentry：目录项
- Super Block：文件系统元信息

重构计划应该包括：
1. Phase 1: 设计新架构
2. Phase 2: 实现核心抽象层
3. Phase 3: 迁移现有功能
4. Phase 4: 测试与优化
5. Phase 5: 清理旧代码
</think>
# VFSCore 重构设计方案

## 一、核心设计理念

将 ConfigManager 重构为 **VFSCore (Virtual File System Manager)**，采用类 Linux VFS 的分层架构：

```
┌─────────────────────────────────────────┐
│        Application Layer (UI)           │
├─────────────────────────────────────────┤
│         VFSCore (VFS Layer)          │  ← 统一接口
├─────────────────────────────────────────┤
│     Content Provider Registry           │  ← 插件管理
├─────────────────────────────────────────┤
│  Plain │ SRS │ Task │ Agent │ Custom   │  ← 内容提供者
├─────────────────────────────────────────┤
│    Inode Layer (Metadata + Content)     │  ← 抽象层
├─────────────────────────────────────────┤
│          Storage Layer (IndexedDB)       │  ← 持久化
└─────────────────────────────────────────┘
```

---

## 二、新架构设计

### 2.1 核心概念映射

| Linux 概念 | VFSCore 概念 | 说明 |
|-----------|----------------|------|
| VFS | VFSCore | 统一的文件系统接口 |
| inode | VNode (Virtual Node) | 文件/目录元数据 |
| dentry | Path Entry | 路径到 inode 的映射 |
| super_block | ModuleInfo | 模块（命名空间）元信息 |
| file operations | ContentProvider | 内容类型处理器 |
| device driver | Provider Plugin | 可插拔的内容处理器 |

### 2.2 目录结构

```
vfsCore/
├── core/
│   ├── VFSCore.js           # 主入口
│   ├── VNode.js                # 虚拟节点抽象
│   ├── VFS.js                  # VFS 核心层
│   └── PathResolver.js         # 路径解析器
├── providers/
│   ├── base/
│   │   └── ContentProvider.js  # 基类
│   ├── PlainTextProvider.js    # 纯文本
│   ├── SRSProvider.js          # 间隔重复
│   ├── TaskProvider.js         # 任务管理
│   ├── AgentProvider.js        # Agent
│   ├── LinkProvider.js         # 链接
│   └── CompositeProvider.js    # 组合多个 provider
├── registry/
│   ├── ProviderRegistry.js     # Provider 注册表
│   └── ModuleRegistry.js       # 模块注册表
├── storage/
│   ├── Database.js             # 存储抽象
│   ├── InodeStore.js           # inode 存储
│   └── ContentStore.js         # 内容存储
├── utils/
│   ├── EventBus.js             # 事件总线
│   ├── Transaction.js          # 事务管理
│   └── Cache.js                # 缓存层
└── legacy/
    └── ConfigManagerAdapter.js # 兼容层
```

---

## 三、详细设计

### 3.1 VNode (虚拟节点)

```javascript
/**
 * VNode - 虚拟文件系统节点
 * 类比 Linux inode，存储文件元数据
 */
class VNode {
    constructor(options) {
        // 基础属性
        this.id = options.id;                    // 唯一标识符
        this.type = options.type;                // 'file' | 'directory' | 'symlink'
        this.module = options.module;            // 所属模块（命名空间）
        
        // 路径信息
        this.name = options.name;                // 节点名称
        this.parent = options.parent;            // 父节点 ID
        
        // 内容类型
        this.contentType = options.contentType || 'plain';  // 内容类型
        this.providers = options.providers || [];           // 关联的 providers
        
        // 元数据
        this.meta = {
            size: 0,                             // 内容大小
            createdAt: new Date(),
            modifiedAt: new Date(),
            accessedAt: new Date(),
            permissions: '0644',                 // 权限
            owner: null,
            tags: [],
            ...options.meta
        };
        
        // 内容引用（不直接存储内容）
        this.contentRef = null;                  // 内容存储的引用
        
        // 缓存状态
        this._cached = false;
        this._content = null;
    }
    
    // Getter/Setter
    get path() {
        // 通过 PathResolver 动态计算
        return PathResolver.resolvePath(this);
    }
    
    isDirectory() {
        return this.type === 'directory';
    }
    
    isFile() {
        return this.type === 'file';
    }
}
```

### 3.2 ContentProvider 基类

```javascript
/**
 * ContentProvider - 内容提供者基类
 * 类比 Linux 的 file_operations
 */
class ContentProvider {
    constructor(name, options = {}) {
        this.name = name;
        this.priority = options.priority || 0;  // 执行优先级
        this.capabilities = options.capabilities || [];
    }
    
    /**
     * 检查是否可以处理该节点
     * @param {VNode} vnode
     * @returns {boolean}
     */
    canHandle(vnode) {
        return vnode.providers.includes(this.name);
    }
    
    /**
     * 读取内容
     * @param {VNode} vnode
     * @param {object} options
     * @returns {Promise<{content: string, metadata: object}>}
     */
    async read(vnode, options = {}) {
        throw new Error(`${this.name}: read() must be implemented`);
    }
    
    /**
     * 写入内容
     * @param {VNode} vnode
     * @param {string} content
     * @param {IDBTransaction} transaction
     * @returns {Promise<{updatedContent: string, derivedData: object}>}
     */
    async write(vnode, content, transaction) {
        throw new Error(`${this.name}: write() must be implemented`);
    }
    
    /**
     * 验证内容
     * @param {VNode} vnode
     * @param {string} content
     * @returns {Promise<{valid: boolean, errors: string[]}>}
     */
    async validate(vnode, content) {
        return { valid: true, errors: [] };
    }
    
    /**
     * 清理派生数据
     * @param {VNode} vnode
     * @param {IDBTransaction} transaction
     */
    async cleanup(vnode, transaction) {
        // 默认不需要清理
    }
    
    /**
     * 获取派生数据统计
     * @param {VNode} vnode
     * @returns {Promise<object>}
     */
    async getStats(vnode) {
        return {};
    }
    
    /**
     * 处理节点移动
     * @param {VNode} vnode
     * @param {string} newPath
     * @param {IDBTransaction} transaction
     */
    async onMove(vnode, newPath, transaction) {
        // 默认不需要处理
    }
    
    /**
     * 处理节点复制
     * @param {VNode} sourceVNode
     * @param {VNode} targetVNode
     * @param {IDBTransaction} transaction
     */
    async onCopy(sourceVNode, targetVNode, transaction) {
        // 默认不需要处理
    }
}
```

### 3.3 ProviderRegistry

```javascript
/**
 * ProviderRegistry - Provider 注册表
 */
class ProviderRegistry {
    constructor() {
        this.providers = new Map();           // name -> provider
        this.typeMappings = new Map();        // contentType -> provider names
        this.hooks = new Map();               // lifecycle hooks
    }
    
    /**
     * 注册 provider
     */
    register(provider) {
        if (!(provider instanceof ContentProvider)) {
            throw new Error('Must be a ContentProvider instance');
        }
        
        this.providers.set(provider.name, provider);
        console.log(`[VFS] Registered provider: ${provider.name}`);
        
        // 触发注册钩子
        this._triggerHook('provider:registered', provider);
    }
    
    /**
     * 注销 provider
     */
    unregister(name) {
        const provider = this.providers.get(name);
        if (provider) {
            this.providers.delete(name);
            this._triggerHook('provider:unregistered', provider);
        }
    }
    
    /**
     * 获取 provider
     */
    get(name) {
        return this.providers.get(name);
    }
    
    /**
     * 为节点获取所有适用的 providers
     */
    getProvidersForNode(vnode) {
        const providers = [];
        
        for (const providerName of vnode.providers) {
            const provider = this.get(providerName);
            if (provider && provider.canHandle(vnode)) {
                providers.push(provider);
            }
        }
        
        // 按优先级排序
        return providers.sort((a, b) => b.priority - a.priority);
    }
    
    /**
     * 注册类型映射
     */
    mapType(contentType, providerNames) {
        this.typeMappings.set(contentType, providerNames);
    }
    
    /**
     * 根据类型获取默认 providers
     */
    getDefaultProviders(contentType) {
        return this.typeMappings.get(contentType) || ['plain'];
    }
    
    /**
     * 注册生命周期钩子
     */
    onHook(event, callback) {
        if (!this.hooks.has(event)) {
            this.hooks.set(event, []);
        }
        this.hooks.get(event).push(callback);
    }
    
    _triggerHook(event, data) {
        const callbacks = this.hooks.get(event) || [];
        callbacks.forEach(cb => {
            try {
                cb(data);
            } catch (error) {
                console.error(`Hook error for ${event}:`, error);
            }
        });
    }
}
```

### 3.4 VFS 核心层

```javascript
/**
 * VFS - 虚拟文件系统核心
 */
class VFS {
    constructor(storage, registry, eventBus) {
        this.storage = storage;              // Storage layer
        this.registry = registry;            // Provider registry
        this.events = eventBus;              // Event bus
        this.cache = new VFSCache();         // Cache layer
        this.pathResolver = new PathResolver(this);
    }
    
    /**
     * 创建节点
     */
    async createNode(options) {
        const {
            type,
            module,
            path,
            contentType = 'plain',
            content = '',
            meta = {}
        } = options;
        
        // 1. 创建 VNode
        const vnode = new VNode({
            id: this._generateId(module),
            type,
            module,
            name: this.pathResolver.basename(path),
            parent: await this.pathResolver.resolveParent(module, path),
            contentType,
            providers: this.registry.getDefaultProviders(contentType),
            meta
        });
        
        // 2. 初始化内容
        const tx = await this.storage.beginTransaction();
        
        try {
            // 使用 providers 处理内容
            let processedContent = content;
            const allDerivedData = {};
            
            for (const provider of this.registry.getProvidersForNode(vnode)) {
                const result = await provider.write(vnode, processedContent, tx);
                processedContent = result.updatedContent;
                Object.assign(allDerivedData, result.derivedData);
            }
            
            // 3. 保存到存储
            vnode.contentRef = await this.storage.saveContent(
                vnode.id,
                processedContent,
                tx
            );
            
            await this.storage.saveVNode(vnode, tx);
            await tx.commit();
            
            // 4. 更新缓存
            this.cache.set(vnode.id, vnode);
            
            // 5. 发布事件
            this.events.emit('vnode:created', {
                vnode,
                derivedData: allDerivedData
            });
            
            return vnode;
            
        } catch (error) {
            await tx.rollback();
            throw error;
        }
    }
    
    /**
     * 读取节点
     */
    async read(vnodeOrId, options = {}) {
        const vnode = await this._resolveVNode(vnodeOrId);
        if (!vnode) {
            throw new VFSError(`VNode not found: ${vnodeOrId}`);
        }
        
        // 从缓存读取
        if (options.cache !== false && vnode._cached) {
            return {
                content: vnode._content,
                metadata: this._buildMetadata(vnode)
            };
        }
        
        // 从存储读取
        let content = await this.storage.loadContent(vnode.contentRef);
        let metadata = {};
        
        // 通过 providers 增强
        for (const provider of this.registry.getProvidersForNode(vnode)) {
            const result = await provider.read(vnode, options);
            if (result.content) content = result.content;
            Object.assign(metadata, result.metadata);
        }
        
        // 更新缓存
        if (options.cache !== false) {
            vnode._content = content;
            vnode._cached = true;
            this.cache.set(vnode.id, vnode);
        }
        
        return { content, metadata };
    }
    
    /**
     * 写入节点
     */
    async write(vnodeOrId, content, options = {}) {
        const vnode = await this._resolveVNode(vnodeOrId);
        if (!vnode) {
            throw new VFSError(`VNode not found: ${vnodeOrId}`);
        }
        
        const tx = await this.storage.beginTransaction();
        
        try {
            // 按优先级通过所有 providers 处理
            let processedContent = content;
            const allDerivedData = {};
            
            for (const provider of this.registry.getProvidersForNode(vnode)) {
                // 验证
                const validation = await provider.validate(vnode, processedContent);
                if (!validation.valid) {
                    throw new ValidationError(validation.errors.join(', '));
                }
                
                // 写入
                const result = await provider.write(vnode, processedContent, tx);
                processedContent = result.updatedContent;
                Object.assign(allDerivedData, result.derivedData);
            }
            
            // 保存到存储
            await this.storage.updateContent(
                vnode.contentRef,
                processedContent,
                tx
            );
            
            // 更新元数据
            vnode.meta.modifiedAt = new Date();
            vnode.meta.size = processedContent.length;
            await this.storage.saveVNode(vnode, tx);
            
            await tx.commit();
            
            // 使缓存失效
            this.cache.invalidate(vnode.id);
            
            // 发布事件
            this.events.emit('vnode:updated', {
                vnode,
                derivedData: allDerivedData
            });
            
            return vnode;
            
        } catch (error) {
            await tx.rollback();
            throw error;
        }
    }
    
    /**
     * 删除节点
     */
    async unlink(vnodeOrId, options = {}) {
        const vnode = await this._resolveVNode(vnodeOrId);
        if (!vnode) return;
        
        const tx = await this.storage.beginTransaction();
        
        try {
            // 收集所有要删除的节点
            const nodesToDelete = vnode.isDirectory() 
                ? await this._collectDescendants(vnode)
                : [vnode];
            
            // 清理所有派生数据
            for (const node of nodesToDelete) {
                for (const provider of this.registry.getProvidersForNode(node)) {
                    await provider.cleanup(node, tx);
                }
                
                // 删除内容
                await this.storage.deleteContent(node.contentRef, tx);
                
                // 删除 VNode
                await this.storage.deleteVNode(node.id, tx);
                
                // 使缓存失效
                this.cache.invalidate(node.id);
            }
            
            await tx.commit();
            
            // 发布事件
            this.events.emit('vnode:deleted', {
                vnode,
                deletedIds: nodesToDelete.map(n => n.id)
            });
            
        } catch (error) {
            await tx.rollback();
            throw error;
        }
    }
    
    /**
     * 移动节点
     */
    async move(vnodeOrId, newPath) {
        // 实现移动逻辑，调用 provider.onMove()
    }
    
    /**
     * 复制节点
     */
    async copy(sourceId, targetPath) {
        // 实现复制逻辑，调用 provider.onCopy()
    }
    
    /**
     * 获取目录树
     */
    async readdir(vnodeOrId, options = {}) {
        const vnode = await this._resolveVNode(vnodeOrId);
        if (!vnode || !vnode.isDirectory()) {
            throw new VFSError('Not a directory');
        }
        
        const children = await this.storage.getChildren(vnode.id);
        
        if (options.recursive) {
            return this._buildTree(children);
        }
        
        return children;
    }
    
    // 私有辅助方法
    async _resolveVNode(vnodeOrId) {
        if (vnodeOrId instanceof VNode) return vnodeOrId;
        
        // 先查缓存
        let vnode = this.cache.get(vnodeOrId);
        if (vnode) return vnode;
        
        // 再查存储
        vnode = await this.storage.loadVNode(vnodeOrId);
        if (vnode) this.cache.set(vnodeOrId, vnode);
        
        return vnode;
    }
    
    _generateId(module) {
        return `${module}-${uuidv4()}`;
    }
    
    _buildMetadata(vnode) {
        return {
            ...vnode.meta,
            id: vnode.id,
            type: vnode.type,
            contentType: vnode.contentType,
            providers: vnode.providers
        };
    }
}
```

### 3.5 VFSCore (主入口)

```javascript
/**
 * VFSCore - 主入口
 * 提供向后兼容的 API
 */
export class VFSCore {
    static #instance = null;
    
    static getInstance() {
        if (!VFSCore.#instance) {
            VFSCore.#instance = new VFSCore();
        }
        return VFSCore.#instance;
    }
    
    constructor() {
        if (VFSCore.#instance) {
            return VFSCore.#instance;
        }
        
        this.storage = null;
        this.registry = null;
        this.events = null;
        this.vfs = null;
        
        // 向后兼容
        this.legacy = null;
        
        VFSCore.#instance = this;
    }
    
    /**
     * 初始化
     */
    async init(options = {}) {
        // 1. 初始化存储层
        this.storage = new VFSStorage(options.storage);
        await this.storage.connect();
        
        // 2. 初始化事件总线
        this.events = new EventBus();
        
        // 3. 初始化 Provider 注册表
        this.registry = new ProviderRegistry();
        
        // 4. 注册内置 providers
        this._registerBuiltInProviders();
        
        // 5. 注册用户自定义 providers
        if (options.providers) {
            options.providers.forEach(p => this.registry.register(p));
        }
        
        // 6. 创建 VFS 核心
        this.vfs = new VFS(this.storage, this.registry, this.events);
        
        // 7. 初始化默认配置
        await this._ensureDefaults(options.defaults);
        
        // 8. 创建兼容层
        if (options.legacyMode !== false) {
            this.legacy = new ConfigManagerAdapter(this);
        }
        
        console.log('[VFSCore] Initialized successfully');
    }
    
    /**
     * 注册内置 providers
     */
    _registerBuiltInProviders() {
        this.registry.register(new PlainTextProvider());
        this.registry.register(new SRSProvider(this.storage, this.events));
        this.registry.register(new TaskProvider(this.storage, this.events));
        this.registry.register(new AgentProvider(this.storage, this.events));
        this.registry.register(new LinkProvider(this.storage, this.events));
        
        // 类型映射
        this.registry.mapType('plain', ['plain']);
        this.registry.mapType('markdown', ['plain', 'link', 'srs', 'task', 'agent']);
        this.registry.mapType('note', ['plain', 'link', 'srs']);
        this.registry.mapType('task', ['task']);
    }
    
    // ========== 向后兼容 API ==========
    
    async createFile(moduleName, path, content = '') {
        return this.vfs.createNode({
            type: 'file',
            module: moduleName,
            path,
            contentType: 'markdown',
            content
        });
    }
    
    async createDirectory(moduleName, path) {
        return this.vfs.createNode({
            type: 'directory',
            module: moduleName,
            path
        });
    }
    
    async updateNodeContent(nodeId, content) {
        return this.vfs.write(nodeId, content);
    }
    
    async getNodeById(nodeId) {
        return this.vfs.read(nodeId);
    }
    
    async deleteNode(nodeId) {
        return this.vfs.unlink(nodeId);
    }
    
    async getTree(moduleName) {
        const rootNode = await this._getModuleRoot(moduleName);
        return this.vfs.readdir(rootNode, { recursive: true });
    }
    
    // ========== 新 VFS API ==========
    
    /**
     * 注册自定义 provider
     */
    registerProvider(provider) {
        this.registry.register(provider);
    }
    
    /**
     * 挂载新模块
     */
    async mount(moduleName, options = {}) {
        // 创建模块根节点
        // 实现模块挂载逻辑
    }
    
    /**
     * 卸载模块
     */
    async unmount(moduleName) {
        // 实现模块卸载逻辑
    }
    
    /**
     * 获取统计信息
     */
    async getStats(moduleName) {
        // 实现统计逻辑
    }
    
    /**
     * 订阅事件
     */
    on(event, callback) {
        return this.events.on(event, callback);
    }
}

// 导出单例获取函数
export function getVFSManager() {
    return VFSCore.getInstance();
}
```

---

## 四、重构计划

### Phase 1: 准备阶段 (1-2 天)

**目标**：设计验证和团队对齐

**任务**：
- [ ] 评审设计方案
- [ ] 确定重构范围和优先级
- [ ] 建立测试基准
- [ ] 创建重构分支 `refactor/vfs-architecture`

**产出**：
- 确认的设计文档
- 性能基准报告
- 重构任务清单

---

### Phase 2: 核心抽象层 (3-5 天)

**目标**：实现 VFS 核心抽象，不影响现有功能

**任务**：

#### 2.1 基础设施
```bash
# 创建新目录结构
mkdir -p vfsCore/{core,providers/{base},registry,storage,utils,legacy}

# 实现核心类
touch vfsCore/core/{VNode,VFS,PathResolver,VFSError}.js
touch vfsCore/providers/base/ContentProvider.js
touch vfsCore/registry/{ProviderRegistry,ModuleRegistry}.js
touch vfsCore/storage/{VFSStorage,InodeStore,ContentStore}.js
touch vfsCore/utils/{EventBus,Transaction,Cache}.js
```

#### 2.2 实现顺序
1. **VNode** (0.5天)
   - 基础属性
   - 元数据结构
   - 序列化/反序列化

2. **ContentProvider 基类** (0.5天)
   - 接口定义
   - 生命周期钩子
   - 默认实现

3. **ProviderRegistry** (1天)
   - 注册/注销机制
   - 类型映射
   - Provider 查找逻辑

4. **VFSStorage** (1天)
   - 适配现有 Database
   - 事务管理
   - 内容与元数据分离

5. **VFS 核心** (1-2天)
   - CRUD 操作
   - Provider 协调
   - 事件发布

#### 2.3 单元测试
```javascript
// tests/unit/VNode.test.js
// tests/unit/ProviderRegistry.test.js
// tests/unit/VFS.test.js
```

**验收标准**：
- [ ] 所有核心类单元测试通过
- [ ] 可以创建/读取/更新/删除 VNode
- [ ] Provider 注册和调用正常

---

### Phase 3: Provider 迁移 (5-7 天)

**目标**：将现有 Repository 包装为 Provider

**任务**：

#### 3.1 PlainTextProvider (0.5天)
```javascript
// vfsCore/providers/PlainTextProvider.js
class PlainTextProvider extends ContentProvider {
    async read(vnode, options) {
        return {
            content: await this.storage.loadContent(vnode.contentRef),
            metadata: {}
        };
    }
    
    async write(vnode, content, tx) {
        return {
            updatedContent: content,
            derivedData: {}
        };
    }
}
```

#### 3.2 SRSProvider (1.5天)
```javascript
// 包装现有 SRSRepository 逻辑
class SRSProvider extends ContentProvider {
    constructor(storage, events) {
        super('srs', { priority: 10 });
        this.storage = storage;
        this.events = events;
    }
    
    // 迁移 reconcileClozes 逻辑
    async write(vnode, content, tx) {
        // ... 原有逻辑
    }
    
    async cleanup(vnode, tx) {
        // ... 清理 SRS 卡片
    }
    
    async getStats(vnode) {
        // ... 统计信息
    }
}
```

#### 3.3 TaskProvider (1.5天)
- 迁移 TaskRepository 逻辑
- 测试任务解析和更新

#### 3.4 AgentProvider (1.5天)
- 迁移 AgentRepository 逻辑
- 测试 Agent 块解析

#### 3.5 LinkProvider (1天)
- 迁移 LinkRepository 逻辑
- 测试反向链接

#### 3.6 集成测试
```javascript
// tests/integration/providers.test.js
describe('Provider Integration', () => {
    it('should process markdown with all providers', async () => {
        const content = `
# Test Note
{{c1::Cloze deletion}} ^clz-123
- [ ] @user [2024-01-01] Task ^task-456
\`\`\`agent:writer ^agent-789
prompt: Write a poem
\`\`\`
[[node-id-abc]]
        `;
        
        const vnode = await vfs.createNode({
            type: 'file',
            module: 'test',
            path: '/test.md',
            contentType: 'markdown',
            content
        });
        
        // 验证所有 provider 都被正确处理
        const { metadata } = await vfs.read(vnode.id);
        expect(metadata.clozes).toHaveLength(1);
        expect(metadata.tasks).toHaveLength(1);
        expect(metadata.agents).toHaveLength(1);
        expect(metadata.links).toHaveLength(1);
    });
});
```

**验收标准**：
- [ ] 所有 Provider 功能测试通过
- [ ] 性能不低于现有实现
- [ ] 派生数据正确处理

---

### Phase 4: VFSCore 实现 (2-3 天)

**目标**：实现主入口和兼容层

#### 4.1 VFSCore 主类 (1天)
```javascript
// vfsCore/VFSCore.js
export class VFSCore {
    async init(options) {
        // 初始化所有组件
    }
    
    // 向后兼容 API
    async createFile() { }
    async updateNodeContent() { }
    
    // 新 VFS API
    async mount() { }
    registerProvider() { }
}
```

#### 4.2 兼容层 (1天)
```javascript
// vfsCore/legacy/ConfigManagerAdapter.js
/**
 * 提供完全向后兼容的 ConfigManager API
 */
export class ConfigManagerAdapter {
    constructor(vfsCore) {
        this.vfs = vfsCore;
    }
    
    async createFile(moduleName, path, content) {
        return this.vfs.createFile(moduleName, path, content);
    }
    
    // ... 映射所有旧 API
}
```

#### 4.3 迁移脚本 (0.5天)
```javascript
// scripts/migrateToVFS.js
/**
 * 数据迁移脚本
 * 将旧格式数据转换为 VFS 格式
 */
async function migrateDatabase() {
    // 1. 读取旧数据
    const oldData = await exportDatabase(oldDB);
    
    // 2. 转换为 VFS 格式
    const newData = transformToVFS(oldData);
    
    // 3. 导入新数据
    await vfsCore.import(newData);
}
```

**验收标准**：
- [ ] 所有旧 API 可通过兼容层调用
- [ ] 现有测试套件全部通过
- [ ] 数据迁移脚本验证通过

---

### Phase 5: 渐进式替换 (3-5 天)

**目标**：逐步替换应用中的调用

#### 5.1 识别调用点
```bash
# 查找所有 ConfigManager 使用
grep -r "ConfigManager\|getConfigManager" src/
```

#### 5.2 替换策略
```javascript
// 旧代码
import { getConfigManager } from './configManager';
const cm = getConfigManager();
await cm.createFile('notes', '/test.md', 'content');

// 新代码（过渡期）
import { getVFSManager } from './vfsCore';
const vfs = getVFSManager();
await vfs.createFile('notes', '/test.md', 'content'); // 兼容 API

// 新代码（最终）
const vnode = await vfs.vfs.createNode({
    type: 'file',
    module: 'notes',
    path: '/test.md',
    contentType: 'markdown',
    content: 'content'
});
```

#### 5.3 模块替换顺序
1. **工具模块** (1天)
   - 独立功能
   - 低依赖

2. **UI 层** (1-2天)
   - 编辑器组件
   - 文件浏览器

3. **核心业务逻辑** (1-2天)
   - 工作流
   - LLM 集成

**验收标准**：
- [ ] 所有模块迁移完成
- [ ] E2E 测试通过
- [ ] 无性能回归

---

### Phase 6: 优化与清理 (2-3 天)

**目标**：优化性能，清理旧代码

#### 6.1 性能优化
- [ ] 实现智能缓存策略
- [ ] 批量操作优化
- [ ] 索引优化

#### 6.2 文档更新
- [ ] API 文档
- [ ] 架构图
- [ ] 迁移指南
- [ ] Provider 开发指南

#### 6.3 清理旧代码
```bash
# 备份旧代码
git tag v1.0-legacy
git checkout -b archive/config-manager
git mv configManager configManager.old
git commit -m "Archive old ConfigManager"

# 清理主分支
git checkout refactor/vfs-architecture
rm -rf configManager.old
```

**验收标准**：
- [ ] 性能指标达标
- [ ] 文档完整
- [ ] 代码覆盖率 >80%

---

## 五、向后兼容策略

### 5.1 API 映射表

| ConfigManager API | VFSCore API | 说明 |
|------------------|----------------|------|
| `createFile()` | `vfs.createNode({type:'file'})` | 兼容层自动映射 |
| `getNodeById()` | `vfs.read()` | 返回格式略有不同 |
| `updateNodeContent()` | `vfs.write()` | Provider 自动处理 |
| `deleteNode()` | `vfs.unlink()` | 语义更符合 POSIX |
| `getTree()` | `vfs.readdir({recursive:true})` | 新 API 更灵活 |

### 5.2 过渡期方案

```javascript
// Option 1: 全局替换
window.ConfigManager = VFSCore; // 不推荐

// Option 2: 导出别名
export {
    VFSCore as ConfigManager,
    getVFSManager as getConfigManager
};

// Option 3: 兼容层（推荐）
export class ConfigManager extends ConfigManagerAdapter {
    constructor() {
        super(VFSCore.getInstance());
        console.warn('[DEPRECATED] ConfigManager is deprecated. Use VFSCore instead.');
    }
}
```

### 5.3 废弃警告

```javascript
// 在旧 API 中添加废弃警告
async createFile(...args) {
    if (process.env.NODE_ENV !== 'production') {
        console.warn(
            'ConfigManager.createFile() is deprecated. ' +
            'Use vfsCore.vfs.createNode({type:"file"}) instead.'
        );
    }
    return this.vfs.createFile(...args);
}
```

---

## 六、风险与应对

| 风险 | 影响 | 概率 | 应对措施 |
|-----|------|------|---------|
| 性能回归 | 高 | 中 | 性能基准测试、渐进式发布 |
| 数据迁移失败 | 高 | 低 | 完善的回滚机制、灰度发布 |
| API 不兼容 | 中 | 中 | 完善的兼容层、充分测试 |
| 学习曲线陡峭 | 中 | 高 | 详细文档、示例代码 |
| 第三方插件兼容 | 低 | 低 | 提供迁移指南、适配器 |

---

## 七、成功指标

- [ ] 所有现有测试通过
- [ ] 代码覆盖率 ≥ 80%
- [ ] API 响应时间不增加超过 10%
- [ ] 内存占用不增加超过 15%
- [ ] 可以在 1 小时内添加新的 ContentProvider
- [ ] 零数据丢失
- [ ] 文档完整度 100%

---

## 八、时间线总结

| 阶段 | 时间 | 里程碑 |
|-----|------|--------|
| Phase 1 | 1-2天 | 设计确认 |
| Phase 2 | 3-5天 | 核心抽象完成 |
| Phase 3 | 5-7天 | Provider 迁移完成 |
| Phase 4 | 2-3天 | VFSCore 可用 |
| Phase 5 | 3-5天 | 应用迁移完成 |
| Phase 6 | 2-3天 | 优化和发布 |
| **总计** | **16-25天** | **重构完成** |

---

## 九、后续规划

### 9.1 扩展能力
- **插件市场**：第三方 Provider 生态
- **云同步**：RemoteProvider
- **版本控制**：GitProvider
- **加密存储**：EncryptedProvider
- **全文搜索**：SearchProvider

### 9.2 性能优化
- **懒加载**：按需加载 Provider
- **流式处理**：大文件支持
- **并发控制**：批量操作优化
- **索引优化**：查询性能提升

### 9.3 开发者体验
- **CLI 工具**：快速创建 Provider
- **调试工具**：Provider 执行追踪
- **性能分析**：瓶颈识别
- **迁移工具**：自动化迁移

这个重构方案将 ConfigManager 升级为真正的虚拟文件系统，具备高度的可扩展性和灵活性！🚀