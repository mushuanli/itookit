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

    // 用于生成带命名空间的事件名称的模板
    MODULE_LOADED_TPL: 'modules:{ns}:loaded',
    MODULE_UPDATED_TPL: 'modules:{ns}:updated',
};

/**
 * 为模块仓库生成一个带命名空间的事件名称。
 * @param {'loaded' | 'updated'} type - 事件的类型。
 * @param {string} namespace - 命名空间 (例如, 项目ID 'project-alpha')。
 * @returns {string} 完整的事件名称 (例如, 'modules:project-alpha:updated')。
 */
export function getModuleEventName(type, namespace) {
    const template = type === 'loaded' ? EVENTS.MODULE_LOADED_TPL : EVENTS.MODULE_UPDATED_TPL;
    return template.replace('{ns}', namespace);
}
