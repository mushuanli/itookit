/**
 * @file vfs-ui/components/FileOutline/templates.ts
 * @desc HTML template generation functions for the FileOutline component.
 */
import { Heading } from '../../types/types';

interface FileOutlineState {
    headings: Heading[];
    expandedH1Ids: Set<string>;
}

function createHeadingItemHTML(heading: Heading, isExpanded: boolean): string {
    // [修复] 即使可选链后，也要保证后续访问的安全性
    const hasChildren = heading.children && heading.children.length > 0;
    const toggleIconHTML = (heading.level === 1 && hasChildren)
        ? `<span class="vfs-file-outline__toggle ${isExpanded ? 'is-expanded' : ''}" data-action="toggle-expand" title="展开/折叠"></span>`
        : `<span class="vfs-file-outline__toggle is-placeholder"></span>`;
    const titleAttr = heading.text.length > 35 ? ` title="${heading.text.replace(/"/g, '&quot;')}"` : '';
    let childrenHTML = '';
    if (heading.level === 1 && hasChildren && isExpanded) {
        childrenHTML = `<ul class="vfs-file-outline__list">${heading.children!.map(child => createHeadingItemHTML(child, false)).join('')}</ul>`;
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

export function createOutlineHTML(state: FileOutlineState): string {
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
