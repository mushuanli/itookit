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

    // --- [V2] 模块事件系统重构，采用更精确的“富领域事件” ---
    MODULE_LOADED: 'modules:{ns}:loaded',                   // 初始加载完成 (负载: ModuleFSTree)
    MODULE_NODE_ADDED: 'modules:{ns}:node_added',           // 添加了一个新节点 (负载: { parentId: string, newNode: ModuleFSTreeNode })
    MODULE_NODE_REMOVED: 'modules:{ns}:node_removed',       // 移除了一个节点 (负载: { parentId: string, removedNodeId: string })
    MODULE_NODE_RENAMED: 'modules:{ns}:node_renamed',       // 一个节点被重命名 (负载: { updatedNode: ModuleFSTreeNode })
    MODULE_NODE_CONTENT_UPDATED: 'modules:{ns}:node_content_updated', // 文件内容被更新 (负载: { updatedNode: ModuleFSTreeNode })
    MODULE_NODES_META_UPDATED: 'modules:{ns}:nodes_meta_updated',     // 一个或多个节点的元数据被更新 (负载: { updatedNodes: ModuleFSTreeNode[] })
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
 * @typedef {'loaded' | 'node_added' | 'node_removed' | 'node_renamed' | 'node_content_updated' | 'nodes_meta_updated'} ModuleEventType
 */

/**
 * 为模块仓库生成一个带命名空间的事件名称。
 * @param {ModuleEventType} type - 事件的类型。
 * @param {string} namespace - 命名空间 (例如, 项目ID 'project-alpha')。
 * @returns {string} 完整的事件名称。
 */
export function getModuleEventName(type, namespace) {
    const template = EVENTS[`MODULE_${type.toUpperCase()}`];
    if (template) {
        return template.replace('{ns}', namespace);
    }
    throw new Error(`Invalid module event type: ${type}`);
}
