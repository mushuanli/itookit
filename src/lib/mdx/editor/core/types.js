/**
 * @file #mdx/editor/core/types.js
 * @fileoverview Defines shared JSDoc types for the MDxProcessor system.
 */

/**
 * 定义如何处理一种特定类型的 mention。
 * @typedef {object} ProviderProcessRule
 * @property {'replace' | 'remove' | 'keep'} action - 对mention文本在最终输出中执行的操作。
 * @property {(data: any, mention: MentionMatch) => string} [getReplacementContent] - 当 action 为 'replace' 时，用于动态生成替换内容的函数。如果未提供，默认行为是保留原始文本。
 * @property {boolean} [collectMetadata=false] - 如果为 true，则将此mention的ID收集到最终结果的元数据对象中。
 */

/**
 * `MDxProcessor.process` 方法的配置对象。
 * @typedef {object} ProcessOptions
 * @property {Object.<string, ProviderProcessRule>} rules - 一个从 provider key (如 'file', 'app') 到其处理规则的映射。
 *                                                          支持特殊键 '*' 作为所有未明确指定规则的 provider 的默认规则。
 */

/**
 * 表示在文本中找到的一个 mention 实例及其所有相关信息。
 * @typedef {object} MentionMatch
 * @property {string} raw - 原始匹配文本，如 '@file:file1'。
 * @property {string} type - mention类型，如 'file'。
 * @property {string} id - mention ID，如 'file1'。
 * @property {string} uri - 标准化的URI，如 'mdx://file/file1'。
 * @property {number} index - 在原始文本中的起始索引。
 * @property {any} data - 从Provider的`getDataForProcess`方法解析出的数据。
 */

/**
 * `MDxProcessor.process` 方法返回的最终结果对象。
 * @typedef {object} ProcessResult
 * @property {string} originalContent - 原始输入文本。
 * @property {string} transformedContent - 应用所有规则转换后的文本。
 * @property {MentionMatch[]} mentions - 文档中找到的所有mention及其解析数据的完整列表，按出现顺序列出。
 * @property {Object.<string, string[]>} metadata - 根据`collectMetadata`规则收集到的元数据，按类型分组。
 */

// Dummy export to make this file a module.
export const UNUSED = {};
