/**
 * @file vfs-ui/components/FileOutline/templates.js
 * @desc HTML template generation functions for the FileOutline component.
 */

function createHeadingItemHTML(heading, isExpanded) {
    const hasChildren = heading.children?.length > 0;
    const toggleIconHTML = (heading.level === 1 && hasChildren)
        ? `<span class="vfs-file-outline__toggle ${isExpanded ? 'is-expanded' : ''}" data-action="toggle-expand" title="展开/折叠"></span>`
        : `<span class="vfs-file-outline__toggle is-placeholder"></span>`;
    const titleAttr = heading.text.length > 35 ? ` title="${heading.text.replace(/"/g, '&quot;')}"` : '';
    let childrenHTML = '';
    if (heading.level === 1 && hasChildren && isExpanded) {
        childrenHTML = `<ul class="vfs-file-outline__list">${heading.children.map(child => createHeadingItemHTML(child, false)).join('')}</ul>`;
    }
    
    return `
        <li class="vfs-file-outline__item vfs-file-outline__item--level-${heading.level}" 
            data-element-id="${heading.elementId}"
            data-is-expanded="${isExpanded}">
            <a href="#${heading.elementId}" class="vfs-file-outline__link" data-action="navigate">
                ${toggleIconHTML}
                <span class="vfs-file-outline__text"${titleAttr}>${heading.text}</span>
            </a>
            ${childrenHTML}
        </li>
    `;
}

export function createOutlineHTML(state) {
    if (!state.headings || state.headings.length === 0) {
        return `
            <h3 class="vfs-file-outline__title">大纲</h3>
            <div class="vfs-file-outline__placeholder">文档中暂无标题</div>
        `;
    }
    const listHTML = state.headings.map(h => createHeadingItemHTML(h, state.expandedH1Ids.has(h.elementId))).join('');
    return `
        <h3 class="vfs-file-outline__title">大纲</h3>
        <ul class="vfs-file-outline__list">${listHTML}</ul>
    `;
}
