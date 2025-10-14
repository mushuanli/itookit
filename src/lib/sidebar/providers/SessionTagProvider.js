// #sidebar/providers/SessionTagProvider.js

import { IAutocompleteProvider } from '../../common/interfaces/IAutocompleteProvider.js';

/**
 * @class
 * @implements {IAutocompleteProvider}
 * 这是一个具体的标签数据源实现，它从 sessionUI 的 SessionStore 中获取标签数据。
 */
export class SessionTagProvider extends IAutocompleteProvider {
    /**
     * @param {import('../stores/SessionStore.js').SessionStore} store 
     */
    constructor(store) {
        super();
        if (!store) {
            throw new Error("SessionTagProvider requires a SessionStore instance.");
        }
        this.store = store;
    }

    /**
     * 根据查询字符串，从 SessionStore 中获取并过滤标签建议。
     * @param {string} query - 用户在 '#' 后输入的搜索字符串。
     * @returns {Promise<Array<{id: string, label: string}>>}
     */
    async getSuggestions(query) {
        const state = this.store.getState();
        const allTags = Array.from(state.tags.keys());
        
        const lowerCaseQuery = query.toLowerCase();

        const filteredTags = query 
            ? allTags.filter(tag => tag.toLowerCase().includes(lowerCaseQuery))
            : allTags; // 如果没有查询，返回所有标签

        // 格式化为自动完成插件所需的 {id, label} 格式
        return filteredTags.map(tag => ({
            id: tag,
            label: tag
        }));
    }
}
