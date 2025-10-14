// #sidebar/components/DocumentOutline/templates.js

/**
 * @file HTML template generation functions for the DocumentOutline component.
 */

/**
 * Creates the HTML for a single heading item in the outline.
 * @param {import('../../types/types.js')._Heading} heading - The heading data.
 * @param {boolean} isExpanded - Whether the heading (if H1) is expanded.
 * @returns {string} The generated HTML string.
 */
function createHeadingItemHTML(heading, isExpanded) {
    const hasChildren = heading.children && heading.children.length > 0;

    // --- 移植功能 1: 折叠图标 ---
    // 只有当是H1且有子节点时，折叠图标才是可交互的
    const toggleIconHTML = (heading.level === 1 && hasChildren) ?
        `<span class="mdx-document-outline__toggle ${isExpanded ? 'mdx-document-outline__toggle--is-expanded' : ''}" data-action="toggle-expand" title="展开/折叠"></span>` :
        `<span class="mdx-document-outline__toggle mdx-document-outline__toggle--is-placeholder"></span>`;

    // --- 移植功能 2: 长标题处理 ---
    // 为超过35个字符的标题添加 title 属性以显示 tooltip
    const titleAttr = heading.text.length > 35 ? ` title="${heading.text.replace(/"/g, '&quot;')}"` : '';

    let childrenHTML = '';
    if (heading.level === 1 && hasChildren && isExpanded) {
        // [修改] 使用正确的类名
        childrenHTML = `<ul class="mdx-document-outline__list">${heading.children.map(child => createHeadingItemHTML(child, false)).join('')}</ul>`;
    }
    
    // 使用 BEM 命名法，并为 li 添加 data-* 状态属性
    return `
        <li class="mdx-document-outline__item mdx-document-outline__item--level-${heading.level}" 
            data-element-id="${heading.elementId}"
            data-is-expanded="${isExpanded}">
            <a href="#${heading.elementId}" class="mdx-document-outline__link" data-action="navigate">
                ${toggleIconHTML}
                <span class="mdx-document-outline__text"${titleAttr}>${heading.text}</span>
            </a>
            ${childrenHTML}
        </li>
    `;
}


/**
 * Creates the complete inner HTML for the DocumentOutline component.
 * @param {object} state - The local state of the DocumentOutline component.
 * @param {import('../../types/types.js')._Heading[]} state.headings - The list of headings to render.
 * @param {Set<string>} state.expandedH1Ids - A set of expanded H1 element IDs.
 * @returns {string} The complete inner HTML.
 */
export function createOutlineHTML(state) {
    if (!state.headings || state.headings.length === 0) {
        return `
            <h3 class="mdx-document-outline__title">大纲</h3>
            <div class="mdx-document-outline__placeholder">文档中暂无标题</div>
        `;
    }

    const listHTML = state.headings.map(h => createHeadingItemHTML(h, state.expandedH1Ids.has(h.elementId))).join('');

    return `
        <h3 class="mdx-document-outline__title">大纲</h3>
        <ul class="mdx-document-outline__list">${listHTML}</ul>
    `;
}
