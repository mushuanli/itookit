/**
 * @file mdxeditor/core/types.js
 * @description Defines shared JSDoc types for the MDxProcessor system.
 */

/**
 * Defines how to process a specific type of mention.
 * @typedef {object} ProviderProcessRule
 * @property {'replace' | 'remove' | 'keep'} action - The action to perform on the mention text in the final output.
 * @property {function(*, MentionMatch): string} [getReplacementContent] - A function to dynamically generate replacement content when the action is 'replace'. If not provided, the original text is kept by default.
 * @property {boolean} [collectMetadata=false] - If true, the ID of this mention is collected into the final result's metadata object.
 */

/**
 * The configuration object for the `MDxProcessor.process` method.
 * @typedef {object} ProcessOptions
 * @property {Object.<string, ProviderProcessRule>} rules - A map from a provider key (e.g., 'file', 'app') to its processing rule.
 *                                                          Supports a special key '*' as a default rule for all providers not explicitly specified.
 */

/**
 * Represents a mention instance found in the text with all its related information.
 * @typedef {object} MentionMatch
 * @property {string} raw - The original matched text, e.g., '@file:file1'.
 * @property {string} type - The mention type, e.g., 'file'.
 * @property {string} id - The mention ID, e.g., 'file1'.
 * @property {string} uri - The standardized URI, e.g., 'mdx://file/file1'.
 * @property {number} index - The starting index in the original text.
 * @property {any} data - The data resolved from the provider's `getDataForProcess` method.
 */

/**
 * The final result object returned by the `MDxProcessor.process` method.
 * @typedef {object} ProcessResult
 * @property {string} originalContent - The original input text.
 * @property {string} transformedContent - The text after all rule transformations have been applied.
 * @property {MentionMatch[]} mentions - A complete list of all mentions found in the document with their resolved data, sorted by appearance.
 * @property {Object.<string, string[]>} metadata - The metadata collected according to `collectMetadata` rules, grouped by type.
 */

// Dummy export to make this file a module.
export const UNUSED = {};
