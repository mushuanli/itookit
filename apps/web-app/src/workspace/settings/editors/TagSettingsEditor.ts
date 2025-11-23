// @file: app/workspace/settings/editors/TagSettingsEditor.ts
import { BaseSettingsEditor } from './BaseSettingsEditor';
import { Modal, Toast } from '../components/UIComponents';
import { Tag } from '../types';
import { generateShortUUID } from '@itookit/common';

export class TagSettingsEditor extends BaseSettingsEditor {
    
    render() {
        const tags = this.service.getTags();
        // 排序：引用次数倒序
        const sortedTags = tags.sort((a, b) => (b.count || 0) - (a.count || 0));

        // 计算统计数据
        const totalTags = tags.length;
        const totalRefs = tags.reduce((sum, t) => sum + (t.count || 0), 0);
        const unusedTags = tags.filter(t => (t.count || 0) === 0).length;

        this.container.innerHTML = `
            <div class="settings-page">
                <div class="settings-page__header">
                    <div>
                        <h2 class="settings-page__title">标签管理</h2>
                        <p class="settings-page__description">管理和组织您的内容标签</p>
                    </div>
                    <button id="btn-add-tag" class="settings-btn settings-btn--primary">
                        <span class="settings-btn__icon">+</span> 添加标签
                    </button>
                </div>

                <div class="settings-tags__stats">
                    <div class="settings-stat-card">
                        <div class="settings-stat-card__value">${totalTags}</div>
                        <div class="settings-stat-card__label">总标签数</div>
                    </div>
                    <div class="settings-stat-card">
                        <div class="settings-stat-card__value">${totalRefs}</div>
                        <div class="settings-stat-card__label">标签引用次数</div>
                    </div>
                    <div class="settings-stat-card">
                        <div class="settings-stat-card__value">${unusedTags}</div>
                        <div class="settings-stat-card__label">未使用标签</div>
                    </div>
                </div>

                <div class="settings-tags__grid">
                    ${sortedTags.map(tag => this.renderTagCard(tag)).join('')}
                </div>

                ${tags.length === 0 ? `
                    <div class="settings-empty">
                        <div class="settings-empty__icon">🏷️</div>
                        <h3 class="settings-empty__title">还没有创建标签</h3>
                        <p class="settings-empty__text">创建标签来组织和分类您的内容</p>
                    </div>
                ` : ''}
            </div>
        `;

        this.bindEvents();
    }

    private renderTagCard(tag: Tag) {
        const color = tag.color || '#3b82f6';
        const count = tag.count || 0;

        return `
            <div class="settings-tag-card" style="--tag-color: ${color}" data-id="${tag.id}">
                <div class="settings-tag-card__header">
                    <h3 class="settings-tag-card__name" style="color: ${color}">#${tag.name}</h3>
                    <span class="settings-badge">${count} 引用</span>
                </div>
                <p class="settings-tag-card__desc">${tag.description || '暂无描述'}</p>
                <div class="settings-tag-card__meta">
                    <input type="color" value="${color}" class="settings-color-picker" title="更改颜色">
                    <div class="settings-tag-card__actions">
                        <button class="settings-btn-icon-small settings-btn-edit" title="编辑">✏️</button>
                        <button class="settings-btn-icon-small settings-btn-delete" title="删除">🗑️</button>
                    </div>
                </div>
            </div>
        `;
    }

    private bindEvents() {
        this.clearListeners();
        
        this.addEventListener(this.container.querySelector('#btn-add-tag'), 'click', () => this.showEditModal(null));

        const grid = this.container.querySelector('.settings-tags__grid');
        if (grid) {
            this.addEventListener(grid, 'click', (e) => {
                const target = e.target as HTMLElement;
                const card = target.closest('.settings-tag-card') as HTMLElement;
                if (!card) return;

                const tagId = card.dataset.id!;
                const tag = this.service.getTags().find(t => t.id === tagId);
                if (!tag) return;

                if (target.closest('.settings-btn-edit')) {
                    this.showEditModal(tag);
                } else if (target.closest('.settings-btn-delete')) {
                    this.deleteTag(tag);
                }
            });

            this.addEventListener(grid, 'change', (e) => {
                const target = e.target as HTMLInputElement;
                if (target.classList.contains('settings-color-picker')) {
                    const card = target.closest('.settings-tag-card') as HTMLElement;
                    const tagId = card.dataset.id!;
                    const tag = this.service.getTags().find(t => t.id === tagId);
                    if (tag) {
                        this.service.saveTag({ ...tag, color: target.value });
                        Toast.success('颜色已更新');
                    }
                }
            });
        }
    }

    private showEditModal(tag: Tag | null) {
        const isNew = !tag;
        const modalContent = `
            <form id="tag-form" class="settings-form">
                <div class="settings-form__group">
                    <label class="settings-form__label">标签名称 *</label>
                    <input type="text" class="settings-form__input" name="name" value="${tag?.name || ''}" required placeholder="例如: 重要, 待办">
                </div>
                <div class="settings-form__group">
                    <label class="settings-form__label">颜色</label>
                    <input type="color" class="settings-form__input" name="color" value="${tag?.color || '#3b82f6'}">
                </div>
                <div class="settings-form__group">
                    <label class="settings-form__label">描述</label>
                    <textarea class="settings-form__textarea" name="description" placeholder="描述这个标签的用途...">${tag?.description || ''}</textarea>
                </div>
            </form>
        `;

        new Modal(isNew ? '添加标签' : '编辑标签', modalContent, {
            confirmText: '保存',
            onConfirm: async () => {
                const form = document.getElementById('tag-form') as HTMLFormElement;
                if (!form.checkValidity()) {
                    form.reportValidity();
                    return false;
                }
                const formData = new FormData(form);
                const newTag: Tag = {
                    id: tag?.id || `tag-${generateShortUUID()}`,
                    name: formData.get('name') as string,
                    color: formData.get('color') as string,
                    description: formData.get('description') as string,
                    count: tag?.count || 0
                };
                
                await this.service.saveTag(newTag);
                Toast.success(isNew ? '标签已创建' : '标签已更新');
            }
        }).show();
    }

    private deleteTag(tag: Tag) {
        const msg = tag.count && tag.count > 0
            ? `标签"${tag.name}"被引用了 ${tag.count} 次，删除后相关引用也会被移除。确定继续吗？`
            : `确定要删除标签"${tag.name}"吗？`;

        Modal.confirm('确认删除', msg, async () => {
            await this.service.deleteTag(tag.id);
            Toast.success('标签已删除');
        });
    }
}
