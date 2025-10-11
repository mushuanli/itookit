// #config/shared/constants.js

/**
 * @fileoverview 用于集中管理存储键 (Storage Keys) 和事件名称 (Event Names) 的常量文件。
 * @description 将所有魔术字符串统一定义在此处，可以避免拼写错误，并使代码更易于维护和重构。
 */

export const STORAGE_KEYS = {
    TAGS: 'global_tags',
    LLM_CONFIG: 'global_llm_config',
    MODULE_PREFIX: 'modules_', // 注意：这是一个前缀，完整的键将是 'modules_project-id'
};

export const EVENTS = {
    APP_READY: 'app:ready',
    APP_BOOTSTRAP_FAILED: 'app:bootstrap_failed',
    
    TAGS_UPDATED: 'tags:updated',

    LLM_AGENTS_UPDATED: 'llm:agents:updated',
    LLM_CONNECTIONS_UPDATED: 'llm:connections:updated',
    LLM_WORKFLOWS_UPDATED: 'llm:workflows:updated',

    // --- [新] 模块的细粒度事件模板 ---
    MODULE_LOADED: 'modules:{ns}:loaded',       // 初始加载完成 (负载: 整个树)
    MODULE_NODE_ADDED: 'modules:{ns}:node_added',   // 添加了一个新节点
    MODULE_NODE_REMOVED: 'modules:{ns}:node_removed', // 移除了一个节点
    MODULE_NODE_UPDATED: 'modules:{ns}:node_updated', // 更新了一个节点 (内容、元数据、重命名等)
};

/**
 * @typedef {import('./types.js').ModuleFSTreeNode} ModuleFSTreeNode
 */

/**
 * @typedef {object} ModuleNodeAddedPayload
 * @property {string} parentPath - 被添加节点的父节点的路径。
 * @property {ModuleFSTreeNode} newNode - 被添加的完整节点对象。
 */

/**
 * @typedef {object} ModuleNodeRemovedPayload
 * @property {string} parentPath - 被移除节点的父节点的路径。
 * @property {string} removedNodePath - 被移除节点的完整路径。
 */

/**
 * @typedef {object} ModuleNodeUpdatedPayload
 * @property {ModuleFSTreeNode} updatedNode - 更新后的完整节点对象。
 */

/**
 * @typedef {'loaded' | 'node_added' | 'node_removed' | 'node_updated'} ModuleEventType
 */

/**
 * 为模块仓库生成一个带命名空间的事件名称。
 * @param {ModuleEventType} type - 事件的类型。
 * @param {string} namespace - 命名空间 (例如, 项目ID 'project-alpha')。
 * @returns {string} 完整的事件名称。
 */
export function getModuleEventName(type, namespace) {
    const templates = {
        'loaded': EVENTS.MODULE_LOADED,
        'node_added': EVENTS.MODULE_NODE_ADDED,
        'node_removed': EVENTS.MODULE_NODE_REMOVED,
        'node_updated': EVENTS.MODULE_NODE_UPDATED,
    };
    return templates[type].replace('{ns}', namespace);
}
