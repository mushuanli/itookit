// 文件: #llm/input/utils.js
/**
 * @file #llm/input/utils.js
 * @description Utility functions for the LLMInputUI component.
 */

export function deepMerge(target, source) {
    for (const key in source) {
        if (source[key] instanceof Object && key in target) {
            Object.assign(source[key], deepMerge(target[key], source[key]));
        }
    }
    Object.assign(target || {}, source);
    return target;
}
