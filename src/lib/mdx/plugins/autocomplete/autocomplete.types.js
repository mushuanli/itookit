/**
 * @file #mdx/plugins/autocomplete/autocomplete.types.js
 * @fileoverview JSDoc type definitions for the Autocomplete system.
 */

/**
 * @typedef {object} AutocompleteSourceOptions
 * @property {string} triggerChar - 触发自动完成的字符, 例如 '@', '#', '/'.
 * @property {import('../../../common/interfaces/IAutocompleteProvider.js').IAutocompleteProvider} provider - 实现了 IAutocompleteProvider 接口的数据提供者实例。
 * @property {(item: object) => string} applyTemplate - 一个函数，当用户选择一个项目时，它接收该项目的数据对象并返回最终要插入到编辑器中的字符串。
 * @property {string} [completionType] - (可选) CodeMirror 下拉列表中每个项目的 CSS 类名，用于样式化。
 */

// Dummy export to make this file a module.
export const UNUSED = {};
