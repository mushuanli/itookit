// src/common/utils.js
export function generateId() {
    return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

export function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, 
        tag => ({
            '&': '&',
            '<': '<',
            '>': '>',
            '"': '"',
            "'": '\''
        }[tag] || tag));
}

export function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash |= 0;
    }
    return hash.toString(36);
}


/**
 * [NEW] 创建一个与 Marked.js 兼容的 slug
 * @param {string} text 
 * @returns {string}
 */
export function slugify(text) {
    if (typeof text !== 'string') {
        return ''; // 防御性编程，如果text不是字符串，返回空
    }
    return text
        .toLowerCase()
        .trim()
        .replace(/[\s\W-]+/g, '-'); // 替换空格和非单词字符为连字符
}

/**
 * [NEW] Generates a consistent HSL color based on a string's hash.
 * This ensures that the same tag always gets the same color.
 * @param {string} str The input string (e.g., a tag name).
 * @returns {{backgroundColor: string, color: string}} An object with background and text color.
 */
export function generateColorFromString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
        hash = hash & hash; // Convert to 32bit integer
    }

    // Generate a hue value between 0 and 360
    const hue = hash % 360;
    
    // Define saturation and lightness for pastel-like colors
    const saturation = 75;
    const lightness = 85;

    // Determine a contrasting text color (black or white)
    // Lightness > 60% generally works well with black text
    const textColor = '#333'; // A dark gray is often softer than pure black

    return {
        backgroundColor: `hsl(${hue}, ${saturation}%, ${lightness}%)`,
        color: textColor,
    };
}
