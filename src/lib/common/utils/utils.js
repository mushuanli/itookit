// #common/utils/utils.js

/**
 * [最终修复版] 为标题生成一个符合URL规范、支持Unicode、且稳定的ID。
 * 此版本直接保留Unicode字符，因为现代浏览器支持它们作为ID。
 * @param {string} text 
 * @returns {string}
 */
export function slugify(text) {
    if (typeof text !== 'string') return '';

    const slug = text
        .toString()
        .toLowerCase()
        .trim()
        // 1. 将空格、下划线及一系常用标点符号替换为连字符
        .replace(/[\s_.,;!?'"()[\]{}]/g, '-')
        
        // 2. 使用支持Unicode的正则表达式移除所有“非法”字符。
        //    \p{L} 匹配任何语言的任何字母 (Letter)。
        //    \p{N} 匹配任何语言的任何数字 (Number)。
        //    [^...] 表示匹配不在集合内的字符。
        //    'u' 标志是必须的，用于启用Unicode支持。
        .replace(/[^\p{L}\p{N}-]+/gu, '')

        // 3. 合并连续的连字符
        .replace(/-+/g, '-')

        // 4. 移除开头和结尾的连字符
        .replace(/^-+|-+$/g, '');

    // 5. 回退机制：如果处理后 slug 为空 (例如输入是 "??!!")，
    //    则使用 simpleHash 确保总能生成一个唯一的ID。
    if (!slug) {
        // 注意：这里不再添加 "heading-" 前缀，因为调用方会添加它。
        return simpleHash(text);
    }

    return slug;
}

/**
 * 为字符串生成一个简单的、非加密的哈希值。
 * @param {string} str 
 * @returns {string}
 */
export function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash |= 0; // 转换为32位整数
    }
    return Math.abs(hash).toString(36);
}

/**
 * 转义HTML特殊字符以防止XSS攻击。
 * @param {string} str 
 * @returns {string}
 */
export function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, 
        tag => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;',
            '"': '&quot;', "'": '&#39;'
        }[tag] || tag)
    );
}
/**
 * 生成唯一ID（新增）
 * @param {string} [prefix]
 * @returns {string}
 */
export function generateId(prefix = 'item') {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}


// A simple debounce utility. Can be moved to common/utils if used elsewhere.
export function debounce(func, delay) {
    let timeout;
    const debounced = function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
    debounced.cancel = () => clearTimeout(timeout);
    return debounced;
}


/**
 * A simple utility to check if a function is an ES6 class.
 * @param {any} v
 * @returns {boolean}
 */
export function isClass(v) {
  return typeof v === 'function' && /^\s*class\s+/.test(v.toString());
}

/**
 * 生成一个符合 RFC4122 v4 规范的通用唯一标识符 (UUID)。
 * @returns {string} - 例如 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx' 格式的字符串。
 */
export function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}