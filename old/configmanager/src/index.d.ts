// #configManager/index.d.ts

/**
 * ConfigManager TypeScript 类型定义
 */

// ==================== 基础类型 ====================

export interface NodeMeta {
    [key: string]: any;
}

export interface Node {
    id: string;
    type: 'file' | 'directory';
    moduleName: string;
    path: string;
    name: string;
    parentId: string | null;
    createdAt: Date;
    updatedAt: Date;
    meta: NodeMeta;
    content?: string;
    children?: Node[];
}

export interface Tag {
    name: string;
    createdAt: string;
}

export interface Link {
    id: number;
    sourceNodeId: string;
    targetNodeId: string;
}

export interface SRSCard {
    id: string;
    nodeId: string;
    moduleName: string;
    content: string;
    status: 'new' | 'learning' | 'review';
    dueAt: Date;
    lastReviewedAt?: Date;
    interval: number;
    easeFactor: number;
    lapses: number;
}

export interface Task {
    id: string;
    nodeId: string;
    userId: string;
    startTime: Date;
    endTime: Date;
    description: string;
    status: 'todo' | 'doing' | 'done';
}

export interface Agent {
    id: string;
    nodeId: string;
    agentName: string;
    prompt: string;
    output: string;
}

export interface Plugin {
    id: string;
    name: string;
    type: string;
    enabled: boolean;
    moduleName?: string;
    config?: Record<string, any>;
}

// ==================== LLM 相关类型 ====================

export type DataType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'any';

export interface LLMAgentInputOutput {
    name: string;
    type: DataType;
    description?: string;
}

export interface LLMModelInfo {
    id: string;
    name: string;
}

export interface LLMToolsConfig {
    [key: string]: any;
}

export interface LLMModelConfig {
    connectionId: string;
    modelName: string;
    systemPrompt?: string;
    temperature?: number;
    maxTokens?: number;
    topP?: number;
    topK?: number;
    frequencyPenalty?: number;
    presencePenalty?: number;
    stopSequences?: string[];
    seed?: number;
    streaming?: boolean;
    timeout?: number;
    responseFormat?: Record<string, any>;
    tools?: LLMToolsConfig;
}

export interface LLMAgentDefinition {
    id: string;
    name: string;
    description?: string;
    icon?: string;
    tags?: string[];
    maxHistoryLength?: number;
    config: LLMModelConfig;
    interface: {
        inputs: LLMAgentInputOutput[];
        outputs: LLMAgentInputOutput[];
    };
}

export interface LLMProviderConnection {
    id: string;
    name: string;
    provider: string;
    apiKey: string;
    baseURL?: string;
    availableModels?: LLMModelInfo[];
}

export interface LLMWorkflowNode {
    id: number;
    type: string;
    position?: [number, number];
    properties?: Record<string, any>;
}

export type LLMWorkflowLink = [number, number, number, number, number, string];

export interface LLMWorkflowDefinition {
    id: string;
    name: string;
    description?: string;
    interface: {
        inputs: LLMAgentInputOutput[];
        outputs: LLMAgentInputOutput[];
    };
    nodes: LLMWorkflowNode[];
    links: LLMWorkflowLink[];
}

// ==================== 操作选项类型 ====================

export interface CreateNodeOptions {
    content?: string;
    meta?: NodeMeta;
}

export interface UpdateNodeOptions {
    content?: string;
    meta?: NodeMeta;
    [key: string]: any;
}

export interface PaginationOptions {
    offset?: number;
    limit?: number;
}

export interface ReviewQueueOptions {
    limit?: number;
}

export interface StorageInfo {
    usage?: number;
    quota?: number;
    usageFormatted?: string;
    quotaFormatted?: string;
    percentUsed?: string;
    error?: string;
    details?: any;
}

export interface SearchOptions extends PaginationOptions {
    moduleName?: string;
}

export interface OperationResult<T = any> {
    success: boolean;
    data?: T;
    error?: string;
}

// ==================== 事件类型 ====================

export type EventCallback<T = any> = (data: T) => void;
export type UnsubscribeFunction = () => void;

export interface EventData {
    [key: string]: any;
}

// ==================== ConfigManager 主接口 ====================

export interface IConfigManager {
    // ==================== 初始化 ====================
    init(): Promise<void>;

    // ==================== 节点操作 ====================
    createFile(moduleName: string, path: string, content?: string): Promise<Node>;
    createDirectory(moduleName: string, path: string): Promise<Node>;
    getNodeById(nodeId: string): Promise<Node | undefined>;
    updateNodeContent(nodeId: string, newContent: string): Promise<Node>;
    updateNodeData(nodeId: string, updates: UpdateNodeOptions): Promise<Node>;
    deleteNode(nodeId: string): Promise<OperationResult<{ removedNodeId: string; allRemovedIds: string[] }>>;
    renameNode(nodeId: string, newName: string): Promise<Node>;
    moveNode(nodeId: string, newParentId: string): Promise<Node>;
    getAllNodes(moduleName: string, options?: PaginationOptions): Promise<Node[]>;
    getTree(moduleName: string): Promise<Node | null>;
    getAllFolders(moduleName: string): Promise<Node[]>;
    getAllFiles(moduleName: string): Promise<Node[]>;

    // ==================== 标签操作 ====================
    addTagToNode(nodeId: string, tagName: string): Promise<OperationResult<void>>;
    removeTagFromNode(nodeId: string, tagName: string): Promise<OperationResult<void>>;
    getTagsForNode(nodeId: string): Promise<string[]>;
    setTagsForNode(nodeId: string, tagNames: string[]): Promise<OperationResult<void>>;
    getAllTags(): Promise<Tag[]>;
    addGlobalTag(tagName: string): Promise<Tag>;
    renameTag(oldTagName: string, newTagName: string): Promise<OperationResult<void>>;
    deleteTag(tagName: string): Promise<OperationResult<void>>;
    findNodesByTag(tagName: string): Promise<Node[]>;

    // ==================== 链接操作 ====================
    getBacklinks(nodeId: string): Promise<Node[]>;

    // ==================== SRS 操作 ====================
    getReviewQueue(options?: ReviewQueueOptions): Promise<SRSCard[]>;
    answerCard(clozeId: string, quality: 'again' | 'hard' | 'good' | 'easy'): Promise<SRSCard>;
    resetCard(clozeId: string): Promise<SRSCard>;
    getStatesForDocument(nodeId: string): Promise<Map<string, SRSCard>>;

    // ==================== 任务操作 ====================
    findTasksByUser(userId: string): Promise<Task[]>;
    findTasksByDateRange(startDate: Date, endDate: Date): Promise<Task[]>;
    updateTaskStatus(taskId: string, newStatus: 'todo' | 'doing' | 'done'): Promise<Task>;

    // ==================== Agent 操作 ====================
    getAllAgents(): Promise<Agent[]>;

    // ==================== 插件操作 ====================
    savePlugin(pluginData: Plugin): Promise<OperationResult<string>>;
    getAllPlugins(): Promise<Plugin[]>;
    getEnabledPlugins(): Promise<Plugin[]>;
    updatePlugin(pluginId: string, updates: Partial<Plugin>): Promise<Plugin>;
    deletePlugin(pluginId: string): Promise<OperationResult<void>>;

    // ==================== LLM 配置操作 ====================
    llm: {
        getConnections(): Promise<LLMProviderConnection[]>;
        addConnection(connection: LLMProviderConnection): Promise<LLMProviderConnection>;
        updateConnections(oldConnections: LLMProviderConnection[], newConnections: LLMProviderConnection[]): Promise<void>;
        removeConnection(connectionId: string): Promise<void>;

        getAgents(): Promise<LLMAgentDefinition[]>;
        addAgent(agent: LLMAgentDefinition): Promise<LLMAgentDefinition>;
        saveAgents(agents: LLMAgentDefinition[]): Promise<void>;
        removeAgent(agentId: string): Promise<void>;

        getWorkflows(): Promise<LLMWorkflowDefinition[]>;
        addWorkflow(workflow: LLMWorkflowDefinition): Promise<LLMWorkflowDefinition>;
        saveWorkflows(workflows: LLMWorkflowDefinition[]): Promise<void>;
        removeWorkflow(workflowId: string): Promise<void>;
    };

    // ==================== 搜索操作 ====================
    globalSearch(query: string, options?: SearchOptions): Promise<Node[]>;

    // ==================== 会话操作（兼容旧接口）====================
    createSession(options: {
        moduleName: string;
        path: string;
        content?: string;
        title?: string;
    }): Promise<Node>;
    findItemById(itemId: string): Promise<Node | undefined>;
    updateItemMetadata(itemId: string, metadataUpdates: {
        title?: string;
        name?: string;
        tags?: string[];
        [key: string]: any;
    }): Promise<OperationResult<void>>;

    // ==================== 联系人操作（高级API）====================
    createContact(moduleName: string, contactData: {
        name: string;
        email?: string;
        phone?: string;
        notes?: string;
        [key: string]: any;
    }): Promise<Node>;
    getAllContacts(moduleName: string): Promise<Node[]>;

    // ==================== 工作区操作 ====================
    getWorkspace(namespace: string): {
        namespace: string;
        configManager: IConfigManager;
    };
    getService(serviceName: string): any;

    // ==================== 事件操作 ====================
    on(eventName: string, callback: EventCallback): UnsubscribeFunction;

    // ==================== 数据管理操作 ====================
    exportAllData(): Promise<{
        meta: {
            version: number;
            exportedAt: string;
        };
        data: Record<string, any[]>;
    }>;
    importAllData(data: any): Promise<void>;
    getStorageInfo(): Promise<StorageInfo>;
    clearAllData(): Promise<void>;
}

// ==================== 导出主类和工厂函数 ====================

export class ConfigManager implements IConfigManager {
    static getInstance(): ConfigManager;
    
    init(): Promise<void>;
    
    createFile(moduleName: string, path: string, content?: string): Promise<Node>;
    createDirectory(moduleName: string, path: string): Promise<Node>;
    getNodeById(nodeId: string): Promise<Node | undefined>;
    updateNodeContent(nodeId: string, newContent: string): Promise<Node>;
    updateNodeData(nodeId: string, updates: UpdateNodeOptions): Promise<Node>;
    deleteNode(nodeId: string): Promise<OperationResult<{ removedNodeId: string; allRemovedIds: string[] }>>;
    renameNode(nodeId: string, newName: string): Promise<Node>;
    moveNode(nodeId: string, newParentId: string): Promise<Node>;
    getAllNodes(moduleName: string, options?: PaginationOptions): Promise<Node[]>;
    getTree(moduleName: string): Promise<Node | null>;
    getAllFolders(moduleName: string): Promise<Node[]>;
    getAllFiles(moduleName: string): Promise<Node[]>;
    
    addTagToNode(nodeId: string, tagName: string): Promise<OperationResult<void>>;
    removeTagFromNode(nodeId: string, tagName: string): Promise<OperationResult<void>>;
    getTagsForNode(nodeId: string): Promise<string[]>;
    setTagsForNode(nodeId: string, tagNames: string[]): Promise<OperationResult<void>>;
    getAllTags(): Promise<Tag[]>;
    addGlobalTag(tagName: string): Promise<Tag>;
    renameTag(oldTagName: string, newTagName: string): Promise<OperationResult<void>>;
    deleteTag(tagName: string): Promise<OperationResult<void>>;
    findNodesByTag(tagName: string): Promise<Node[]>;
    
    getBacklinks(nodeId: string): Promise<Node[]>;
    
    getReviewQueue(options?: ReviewQueueOptions): Promise<SRSCard[]>;
    answerCard(clozeId: string, quality: 'again' | 'hard' | 'good' | 'easy'): Promise<SRSCard>;
    resetCard(clozeId: string): Promise<SRSCard>;
    getStatesForDocument(nodeId: string): Promise<Map<string, SRSCard>>;
    
    findTasksByUser(userId: string): Promise<Task[]>;
    findTasksByDateRange(startDate: Date, endDate: Date): Promise<Task[]>;
    updateTaskStatus(taskId: string, newStatus: 'todo' | 'doing' | 'done'): Promise<Task>;
    
    getAllAgents(): Promise<Agent[]>;
    
    savePlugin(pluginData: Plugin): Promise<OperationResult<string>>;
    getAllPlugins(): Promise<Plugin[]>;
    getEnabledPlugins(): Promise<Plugin[]>;
    updatePlugin(pluginId: string, updates: Partial<Plugin>): Promise<Plugin>;
    deletePlugin(pluginId: string): Promise<OperationResult<void>>;
    
    llm: IConfigManager['llm'];
    
    globalSearch(query: string, options?: SearchOptions): Promise<Node[]>;
    
    createSession(options: Parameters<IConfigManager['createSession']>[0]): Promise<Node>;
    findItemById(itemId: string): Promise<Node | undefined>;
    updateItemMetadata(itemId: string, metadataUpdates: Parameters<IConfigManager['updateItemMetadata']>[1]): Promise<OperationResult<void>>;
    
    createContact(moduleName: string, contactData: Parameters<IConfigManager['createContact']>[1]): Promise<Node>;
    getAllContacts(moduleName: string): Promise<Node[]>;
    
    getWorkspace(namespace: string): ReturnType<IConfigManager['getWorkspace']>;
    getService(serviceName: string): any;
    
    on(eventName: string, callback: EventCallback): UnsubscribeFunction;
    
    exportAllData(): Promise<ReturnType<IConfigManager['exportAllData']>>;
    importAllData(data: any): Promise<void>;
    getStorageInfo(): Promise<StorageInfo>;
    clearAllData(): Promise<void>;
}

export function getConfigManager(): ConfigManager;

export default ConfigManager;
