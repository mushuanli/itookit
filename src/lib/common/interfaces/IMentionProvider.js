/**
 * @file #common/interfaces/IMentionProvider.js
 * @fileoverview Extends the generic provider interface with mention-specific features.
 */

import { IAutocompleteProvider } from './IAutocompleteProvider.js';

/**
 * @class
 * @interface
 * @extends {IAutocompleteProvider}
 * 定义了为 mention 功能提供数据和交互逻辑的契约。
 * 它继承了通用的 getSuggestions 方法，并添加了 mention 特有的方法，如点击处理和悬停预览。
 */
export class IMentionProvider extends IAutocompleteProvider {
    /**
     * 提供者的唯一标识符，对应于 `mdx://` URI 中的主机名部分。
     * @example 'user', 'file', 'jira-ticket'
     * @type {string}
     */
    key;

    /**
     * 在编辑器中触发此 provider 自动完成建议的字符。
     * @type {string}
     */
    triggerChar = '@';

    // getSuggestions(query) 方法已从父类 IAutocompleteProvider 继承，无需再次声明。

    // --- Core Method for Headless Processing ---

    async getDataForProcess(targetURL) {
        return null;
    }

    // --- Methods for UI Interaction (MDxEditor) ---

    async handleClick(targetURL) {
        console.log(`[IMentionProvider:${this.key}] Clicked:`, targetURL.toString());
    }

    async getHoverPreview(targetURL) {
        return null;
    }

    async getContentForTransclusion(targetURL) {
        return null;
    }
}
