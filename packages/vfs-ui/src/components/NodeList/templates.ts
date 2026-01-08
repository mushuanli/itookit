/**
 * @file vfs-ui/components/NodeList/templates.ts
 * @desc HTML template generation functions for NodeList popovers, inputs, and footers.
 */
import { escapeHTML } from '@itookit/common';
import type { UISettings, MenuItem } from '../../types/types';

export const createItemInputHTML = (creatingItem: { type: 'file' | 'directory' }): string => {
    const icon = creatingItem.type === 'directory' ? '📁' : '📄';
    const placeholder = creatingItem.type === 'directory' ? '新目录名称...' : '新文件名称...';
    return `
        <div class="vfs-node-list__item-creator" data-type="${creatingItem.type}">
            <span class="vfs-node-list__item-creator-icon">${icon}</span>
            <input type="text" class="vfs-node-list__item-creator-input" placeholder="${placeholder}" data-action="create-input" />
        </div>`;
};

export const createContextMenuHTML = (items: MenuItem[]): string => {
    if (!items?.length) return '';
    return `<div class="vfs-context-menu"><ul>${items.map(item => {
        if (item.type === 'separator') return '<li class="vfs-context-menu__separator"></li>';
        return `<li><button data-action="${escapeHTML(item.id)}">${item.iconHTML || ''}<span>${escapeHTML(item.label)}</span></button></li>`;
    }).join('')}</ul></div>`;
};

export const createFooterHTML = ({ selectionStatus, selectedCount, isReadOnly }: { 
    selectionStatus: 'none' | 'partial' | 'all'; 
    selectedCount: number; 
    isReadOnly: boolean;
}): string => {
    const isBulkMode = !isReadOnly && selectedCount > 1;

    const checkboxHTML = isReadOnly ? '' : `
        <input type="checkbox" class="vfs-node-list__footer-checkbox" data-action="toggle-select-all" 
            title="${selectionStatus === 'all' ? '全部取消' : '全选'}"
            ${selectionStatus === 'all' ? 'checked' : ''}>`;

    if (isBulkMode) {
        return `
            <div class="vfs-node-list__bulk-bar">
                <div class="vfs-node-list__bulk-bar-info">
                    ${checkboxHTML}
                    <span>已选择 ${selectedCount} 项</span>
                    <button data-action="deselect-all" class="vfs-node-list__bulk-bar-btn--text" title="全部取消">取消</button>
                </div>
                <div class="vfs-node-list__bulk-bar-actions">
                    <button class="vfs-node-list__bulk-bar-btn" data-action="bulk-move" title="移动..."><i class="fas fa-share-square"></i></button>
                    <button class="vfs-node-list__bulk-bar-btn vfs-node-list__bulk-bar-btn--danger" data-action="bulk-delete" title="删除"><i class="fas fa-trash"></i></button>
                </div>
            </div>`;
    }

    return `
        <div class="vfs-node-list__footer-content">
            <div class="vfs-node-list__footer-selection-controls">${checkboxHTML}</div>
            <div class="vfs-node-list__footer-actions-right">
                <button data-action="settings" title="设置"><i class="fas fa-cog"></i></button>
            </div>
        </div>`;
};

export const createSettingsPopoverHTML = (settings: UISettings): string => {
    const btn = (group: keyof UISettings, value: string, label: string) => 
        `<button data-value="${value}" class="vfs-settings-popover__option-btn ${settings[group] === value ? 'is-active' : ''}">${label}</button>`;
    
    const chk = (key: 'summary' | 'tags' | 'badges', label: string) => {
        const settingKey = `show${key.charAt(0).toUpperCase() + key.slice(1)}` as keyof UISettings;
        return `<label class="vfs-settings-popover__checkbox-label"><input type="checkbox" data-key="${key}" ${settings[settingKey] ? 'checked' : ''}> ${label}</label>`;
    };

    return `
        <div class="vfs-settings-popover">
            <div class="vfs-settings-popover__title">排序方式</div>
            <div class="vfs-settings-popover__group" data-setting="sortBy">${btn('sortBy', 'lastModified', '修改时间')}${btn('sortBy', 'title', '标题')}</div>
            <div class="vfs-settings-popover__title">显示密度</div>
            <div class="vfs-settings-popover__group" data-setting="density">${btn('density', 'comfortable', '舒适')}${btn('density', 'compact', '紧凑')}</div>
            <div class="vfs-settings-popover__title">显示内容</div>
            <div class="vfs-settings-popover__checkbox-group" data-setting="show">${chk('summary', '显示摘要')}${chk('tags', '显示标签')}${chk('badges', '显示元数据')}</div>
        </div>`;
};
