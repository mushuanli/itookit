/**
 * @file common/interfaces/ISessionEngine.ts
 * @desc 定义了 Session UI 后端的标准契约。
 * 这使得 UI 和插件（如自动完成）可以透明地与不同的后端工作
 * （例如 vfs-core, REST API, Electron FS, 纯内存实现等）。
 */

/**
 * 通用的节点数据结构
 */
export interface EngineNode {
    id: string;
    parentId: string | null; // 根节点为 null
    name: string;
    type: 'file' | 'directory'; 
    
    /** 文件内容 (仅当 type === 'file' 时存在，且根据加载策略可能延迟加载) */
    content?: string | ArrayBuffer;
    
    /** 子节点列表 (仅当 type === 'directory' 时存在) */
    children?: EngineNode[];
    
    createdAt: number;
    modifiedAt: number;
    
    /** 节点的完整路径 (逻辑路径) */
    path: string;
    
    /** 
     * [新增] 文件大小 (字节数)
     * 对于文件节点，表示文件内容的大小；
     * 对于目录节点，可以为 0 或表示目录下所有文件的总大小（取决于实现）
     */
    size: number;
    
    tags?: string[];
    metadata?: Record<string, any>;
    
    /** 所属模块ID (用于多模块/命名空间系统) */
    moduleId?: string; 

    /** 
     * [新增] 节点的自定义图标 (Emoji 或 URL)
     * 如果存在，UI 应该优先显示此图标，而不是默认的文件/文件夹图标。
     * 这允许后端根据文件扩展名、元数据或特殊文件夹类型来定制显示。
     */
    icon?: string;
}

/**
 * 搜索引擎查询参数
 */
export interface EngineSearchQuery {
    type?: 'file' | 'directory';
    tags?: string[];
    text?: string;
    limit?: number;

    /**
     * [新增] 搜索作用域
     * 用于支持 Mention 功能的上下文控制。
     * - undefined / 空数组: 默认为 Engine 当前绑定的上下文 (当前模块)
     * - ['*']: 全局搜索 (所有模块)
     * - ['modA', 'modB']: 特定模块范围
     */
    scope?: string[]; 
}

export type EngineEventType = 
    | 'node:created' 
    | 'node:updated' 
    | 'node:deleted' 
    | 'node:moved'
    | 'node:batch_updated' // ✨ [新增] 批量更新 (如批量打标签)
    | 'node:batch_moved'   // ✨ [新增] 批量移动
    | 'node:batch_deleted'  // ✅ 新增
    | 'error';

export interface EngineEvent {
    type: EngineEventType;
    /** 具体的事件载荷，通常包含 nodeId, parentId, updatedNodeIds 等信息 */
    payload: any;
}

/**
 * 会话引擎接口
 */
export interface ISessionEngine {
    // --- Read Operations ---
    
    init():Promise<void> ;
    /** 加载当前的根节点树结构 */
    loadTree(): Promise<EngineNode[]>;

    /** 获取指定目录下的子节点列表 */
    getChildren(parentId: string): Promise<EngineNode[]>;

    /** 读取单个节点的内容 */
    readContent(id: string): Promise<string | ArrayBuffer>;
    
    /** 根据ID获取节点详情 */
    getNode(id: string): Promise<EngineNode | null>;
    
    /** 
     * 搜索节点 
     * 支持通过 scope 参数进行全局或跨模块搜索
     */
    search(query: EngineSearchQuery): Promise<EngineNode[]>;
    
    /** 获取系统中所有可用的标签定义 (可选实现) */
    getAllTags?(): Promise<Array<{ name: string; color?: string }>>;

    // --- Write Operations ---
    
    /** 创建文件 (路径计算通常由 engine 内部根据 parentId 处理) */
    createFile(name: string, parentId: string | null, content?: string | ArrayBuffer): Promise<EngineNode>;
    
    /** 
     * [新增] 批量创建文件 (可选实现)
     * 允许后端优化为单次事务/请求。如果未实现，Service 层会回退到 Promise.all 并发调用。
     */
    createFiles?(files: Array<{ title: string; content: string | ArrayBuffer }>, parentId: string | null): Promise<EngineNode[]>;

    /** 创建目录 */
    createDirectory(name: string, parentId: string | null): Promise<EngineNode>;

    /**
     * [新增] 为指定节点创建关联资产（如图片、附件）
     * Engine 会自动计算存储位置 (例如 .filename/asset.png) 并处理目录的惰性创建
     * @param ownerNodeId - 归属的主节点 ID (如 Markdown 文件的 ID)
     * @param filename - 资产文件名 (如 image.png)
     * @param content - 二进制内容
     * @returns 创建的资产节点
     */
    createAsset(ownerNodeId: string, filename: string, content: string | ArrayBuffer): Promise<EngineNode>;

    /**
     * [新增] 获取指定节点的资产目录 ID
     * 如果不存在则返回 null
     */
    getAssetDirectoryId(ownerNodeId: string): Promise<string | null>;

    /** 写入/覆盖文件内容 */
    writeContent(id: string, content: string | ArrayBuffer): Promise<void>;
    
    /** 重命名节点 */
    rename(id: string, newName: string): Promise<void>;
    
    /** 移动节点到新父节点下 (支持批量 ID) */
    move(ids: string[], targetParentId: string | null): Promise<void>;
    
    /** 删除节点 (支持批量 ID) */
    delete(ids: string[]): Promise<void>;
    
    /** 更新元数据 (通常是合并更新) */
    updateMetadata(id: string, metadata: Record<string, any>): Promise<void>;
    
    /** 设置节点的标签 (全量替换) */
    setTags(id: string, tags: string[]): Promise<void>;

    /** 
     * [新增] 批量设置标签
     * 用于解决 Service 层不得不使用 (engine as any).setTagsBatch 的问题。
     * 定义为可选，以便兼容旧的 Engine 实现。
     */
    setTagsBatch?(updates: Array<{ id: string; tags: string[] }>): Promise<void>;

    // --- ✨ [新增] SRS Support ---
    
    /** 
     * 获取当前文件的所有 SRS 状态 
     * 返回 Map: { "clozeId": SRSItemData }
     */
    getSRSStatus?(fileId: string): Promise<Record<string, any>>;
    
    /** 
     * 更新单个卡片状态 
     */
    updateSRSStatus?(fileId: string, clozeId: string, status: any): Promise<void>;
    
    /**
     * 获取全局或当前模块的到期卡片
     */
    getDueCards?(limit?: number): Promise<any[]>;
    
    // --- Events ---
    
    /** 订阅数据变更事件 */
    on(event: EngineEventType, callback: (event: EngineEvent) => void): () => void;
}
