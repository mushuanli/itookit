/**
 * @file common/interfaces/IAutocompleteSource.ts
 * @description Defines the interface for a generic autocomplete data provider.
 * Any data source wishing to integrate with AutocompletePlugin should implement this class.
 */
export interface Suggestion {
    id: string | number;
    label: string;
    type?: string; // 添加 type 字段，方便 UI 区分 (file, tag, directory)
    [key: string]: any;
}

/**
 * @abstract
 * 自动完成数据源接口
 * 定义了为 UI 组件提供建议列表的契约。
 */
export abstract class IAutocompleteSource {
    /**
     * Constructor. Ensures this interface cannot be instantiated directly.
     */
    constructor() {
        if (this.constructor === IAutocompleteSource) {
            throw new Error("IAutocompleteSource is an interface and cannot be instantiated directly.");
        }
    }

    /**
     * Asynchronously fetches a list of suggestions based on the user's query string.
     * @param query - The search string typed by the user after the trigger character.
     * @returns A Promise that resolves to an array of suggestion objects.
     */
    abstract getSuggestions(query: string): Promise<Suggestion[]>;
}
