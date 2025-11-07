/**
 * @file common/interfaces/IAutocompleteProvider.ts
 * @description Defines the interface for a generic autocomplete data provider.
 * Any data source wishing to integrate with AutocompletePlugin should implement this class.
 */
export interface Suggestion {
    id: string | number;
    label: string;
    [key: string]: any;
}

/**
 * @interface
 * 定义了为通用自动完成功能提供建议列表的契约。
 * 任何希望接入 AutocompletePlugin 的数据源都应实现此类。
 */
export abstract class IAutocompleteProvider {
    /**
     * Constructor. Ensures this interface cannot be instantiated directly.
     */
    constructor() {
        if (this.constructor === IAutocompleteProvider) {
            throw new Error("IAutocompleteProvider is an interface and cannot be instantiated directly.");
        }
    }

    /**
     * Asynchronously fetches a list of suggestions based on the user's query string.
     * @param query - The search string typed by the user after the trigger character.
     * @returns A Promise that resolves to an array of suggestion objects.
     */
    abstract getSuggestions(query: string): Promise<Suggestion[]>;
}
