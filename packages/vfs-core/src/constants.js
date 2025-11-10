// #vfs-core/constants.js

/**
 * @fileoverview 定义数据库相关的常量，避免在代码中使用魔法字符串。
 */

// 数据库名称
export const DB_NAME = 'MindOS';

// 数据库版本。每次 schema 变更时，都需要增加此版本号。
export const DB_VERSION = 2; // [修改] 版本号 +1

// 定义所有的 ObjectStore (表) 和其索引
export const OBJECT_STORES = [
    {
        name: 'modules', // 模块表
        keyPath: 'name',
        indexes: []
    },
    // 在 OBJECT_STORES 数组中添加：
    {
        name: 'vnodes', // VNode 元数据表
        keyPath: 'id',
        indexes: [
            { name: 'by_module', keyPath: 'module', unique: false },
            { name: 'by_parent', keyPath: 'parent', unique: false },
            { name: 'by_module_path', keyPath: ['module', 'path'], unique: true },
            { name: 'by_contentType', keyPath: 'contentType', unique: false }
        ]
    },
    {
        name: 'vfs_contents', // 内容存储表
        keyPath: 'ref',
        indexes: [
            { name: 'by_nodeId', keyPath: 'nodeId', unique: true }
        ]
    },
    {
        name: 'nodes', // 节点表 (文件和目录)
        keyPath: 'id',
        indexes: [
            { name: 'by_moduleName', keyPath: 'moduleName', unique: false },
            { name: 'by_parentId', keyPath: 'parentId', unique: false },
            { name: 'by_path', keyPath: 'path', unique: false }, // [修改] 移除唯一约束
            { name: 'by_type', keyPath: 'type', unique: false },
            { name: 'by_updatedAt', keyPath: 'updatedAt', unique: false },
            // [新增] 复合唯一索引，确保在同一个 module 内路径唯一
            { name: 'by_module_path', keyPath: ['moduleName', 'path'], unique: true }
        ]
    },
    {
        name: 'tags', // 标签定义表
        keyPath: 'name',
        indexes: []
    },
    {
        name: 'nodeTags', // 节点与标签的关联表
        keyPath: 'id', // 使用自增主键
        autoIncrement: true,
        indexes: [
            // 复合索引保证同一节点不会重复打上同一标签
            { name: 'by_node_tag', keyPath: ['nodeId', 'tagName'], unique: true },
            { name: 'by_nodeId', keyPath: 'nodeId', unique: false },
            { name: 'by_tagName', keyPath: 'tagName', unique: false }
        ]
    },
    {
        name: 'links', // 文件引用关系表
        keyPath: 'id',
        autoIncrement: true,
        indexes: [
            // 复合索引保证引用关系的唯一性
            { name: 'by_source_target', keyPath: ['sourceNodeId', 'targetNodeId'], unique: true },
            { name: 'by_source', keyPath: 'sourceNodeId', unique: false },
            { name: 'by_target', keyPath: 'targetNodeId', unique: false } // 用于查询反向链接
        ]
    },
    {
        name: 'srsClozes', // SRS (间隔重复记忆) 卡片表
        keyPath: 'id',
        indexes: [
            { name: 'by_nodeId', keyPath: 'nodeId', unique: false },
            { name: 'by_moduleName', keyPath: 'moduleName', unique: false },
            { name: 'by_status', keyPath: 'status', unique: false },
            { name: 'by_dueAt', keyPath: 'dueAt', unique: false } // 核心索引，用于查询复习队列
        ]
    },
    {
        name: 'tasks', // 任务表
        keyPath: 'id',
        indexes: [
            { name: 'by_nodeId', keyPath: 'nodeId', unique: false },
            { name: 'by_userId', keyPath: 'userId', unique: false },
            { name: 'by_startTime', keyPath: 'startTime', unique: false },
            { name: 'by_endTime', keyPath: 'endTime', unique: false },
            { name: 'by_status', keyPath: 'status', unique: false },
            // 复合索引用于高效的时间范围查询
            { name: 'by_time_range', keyPath: ['startTime', 'endTime'], unique: false },
        ]
    },
    {
        name: 'agents', // Agent 信息表
        keyPath: 'id',
        indexes: [
            { name: 'by_nodeId', keyPath: 'nodeId', unique: false },
            { name: 'by_agentName', keyPath: 'agentName', unique: false }
        ]
    },
    {
        name: 'plugins', // 插件表
        keyPath: 'id',
        indexes: [
            { name: 'by_type', keyPath: 'type', unique: false },
            // 【修改】新增索引，用于快速查找模块级插件
            { name: 'by_moduleName', keyPath: 'moduleName', unique: false }
        ]
    },
    // [新增] 用于存储全局 LLM 配置
    {
        name: 'llmConfig', // LLM 配置表 (键值对存储)
        keyPath: 'key', // e.g., 'connections', 'agents', 'workflows'
        indexes: []
    }
];

// 将 ObjectStore 名称导出为常量，方便使用
export const STORES = {
    MODULES: 'modules',
    NODES: 'nodes',
    TAGS: 'tags',
    NODE_TAGS: 'nodeTags',
    LINKS: 'links',
    SRS_CLOZES: 'srsClozes',
    TASKS: 'tasks',
    AGENTS: 'agents',
    PLUGINS: 'plugins',
    LLM_CONFIG: 'llmConfig' // [新增]
};

// [NEW] 定义 LLM 配置的键名常量
export const LLM_CONFIG_KEYS = {
    CONNECTIONS: 'connections',
    AGENTS: 'agents',
    WORKFLOWS: 'workflows',
    PROTECTED_SETTINGS: 'protected_settings' // [新增]
};


// [新增] 定义事件名称常量
export const EVENTS = {
    NODE_ADDED: 'node:added',
    NODE_REMOVED: 'node:removed',
    NODE_MOVED: 'node:moved',
    NODE_RENAMED: 'node:renamed',
    NODE_CONTENT_UPDATED: 'node:content_updated',
    NODE_META_UPDATED: 'node:meta_updated',

    TAGS_UPDATED: 'tags:updated',

    SRS_STATE_UPDATED: 'srs:state_updated',

    LLM_CONFIG_UPDATED: 'llm:config_updated',

    SYSTEM_PROTECTED_SETTINGS_UPDATED: 'system:protected_settings_updated' // [新增]
};

// [已删除] PROTECTED_TAGS 和 PROTECTED_AGENT_IDS 常量已被移除