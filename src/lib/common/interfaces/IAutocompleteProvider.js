/**
 * @file #common/interfaces/IAutocompleteProvider.js
 * @fileoverview Defines the interface for a generic autocomplete data provider.
 */

/**
 * @class
 * @interface
 * 定义了为通用自动完成功能提供建议列表的契约。
 * 任何希望接入 AutocompletePlugin 的数据源都应实现此类。
 */
export class IAutocompleteProvider {
    /**
     * 构造函数。确保该接口不能被直接实例化。
     */
    constructor() {
        if (this.constructor === IAutocompleteProvider) {
            throw new Error("IAutocompleteProvider is an interface and cannot be instantiated directly.");
        }
    }

    /**
     * 根据用户输入的查询字符串，异步获取建议列表。
     * @param {string} query - 用户在触发字符后输入的搜索字符串。
     * @returns {Promise<Array<{id: string | number, label: string, [key: string]: any}>>}
     *          一个解析为建议对象数组的 Promise。每个对象必须包含 `id` 和 `label` 属性，
     *          也可以包含其他任意数据，这些数据将在 `applyTemplate` 中可用。
     */
    async getSuggestions(query) {
        throw new Error("Method 'getSuggestions()' must be implemented by subclasses.");
    }
}
