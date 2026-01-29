// @file: app-settings/editors/RecoverySettingsEditor.ts

import { BaseSettingsEditor, Toast, Modal, type RestorableItem } from '@itookit/common'; // 假设 Modal/Toast 存在
import { IAgentService } from '@itookit/llm-engine';

export class RecoverySettingsEditor extends BaseSettingsEditor<IAgentService> {
    private selectedItems = new Set<string>(); // 存储格式: "type:id"
    private allItems: RestorableItem[] = [];

    async render() {
        // 1. 获取数据
        this.allItems = await this.service.getRestorableItems();
        
        const connections = this.allItems.filter(i => i.type === 'connection');
        const agents = this.allItems.filter(i => i.type === 'agent');
        
        const selectedCount = this.selectedItems.size;
        const hasSelection = selectedCount > 0;

        // 2. 渲染框架
        this.container.innerHTML = `
            <div class="settings-page">
                <div class="settings-page__header">
                    <div>
                        <h2 class="settings-page__title">系统恢复与维护</h2>
                        <p class="settings-page__description">
                            管理系统默认配置。选中项目将其<strong>重置</strong>为出厂默认状态。
                        </p>
                    </div>
                    
                    <!-- 顶部统一操作按钮 -->
                    <button id="btn-batch-restore" class="settings-btn settings-btn--primary" ${!hasSelection ? 'disabled' : ''}>
                        🔄 重置选中项 (${selectedCount})
                    </button>
                </div>

                <div class="recovery-section">
                    <div class="settings-section-header">
                        <h3 class="settings-section-title">🔌 默认连接 (Connections)</h3>
                        <label class="settings-checkbox-label">
                            <input type="checkbox" class="chk-select-all" data-group="connection"> 全选
                        </label>
                    </div>
                    <div class="settings-list-group">
                        ${connections.map(item => this.renderRow(item)).join('')}
                    </div>
                </div>

                <div class="recovery-section" style="margin-top: 2rem;">
                     <div class="settings-section-header">
                        <h3 class="settings-section-title">🤖 默认智能体 (Agents)</h3>
                        <label class="settings-checkbox-label">
                            <input type="checkbox" class="chk-select-all" data-group="agent"> 全选
                        </label>
                    </div>
                    <div class="settings-list-group">
                        ${agents.map(item => this.renderRow(item)).join('')}
                    </div>
                </div>
            </div>
        `;

        this.updateSelectAllCheckboxState('connection', connections);
        this.updateSelectAllCheckboxState('agent', agents);
        this.bindEvents();
    }

    private renderRow(item: RestorableItem): string {
        const key = `${item.type}:${item.id}`;
        const isSelected = this.selectedItems.has(key);
        
        let statusBadge = '';
        let statusClass = '';
        let statusText = '';
        
        switch (item.status) {
            case 'missing':
                statusBadge = '<span class="settings-badge settings-badge--danger">已丢失</span>';
                statusClass = 'status-missing';
                statusText = '文件缺失';
                break;
            case 'modified':
                statusBadge = '<span class="settings-badge settings-badge--warning">已修改</span>';
                statusClass = 'status-modified';
                statusText = '配置已变更';
                break;
            case 'ok':
                // 对于正常状态，使用更柔和的标识，或者不显示 Badge，这里显示绿色表示健康
                statusBadge = '<span class="settings-badge settings-badge--success">正常</span>';
                statusClass = 'status-ok';
                statusText = '系统默认';
                break;
        }

        return `
            <div class="settings-list-item ${statusClass}" data-key="${key}">
                <div class="settings-list-item__check">
                    <input type="checkbox" class="chk-item" value="${key}" ${isSelected ? 'checked' : ''}>
                </div>
                <div class="settings-list-item__icon">${item.icon}</div>
                <div class="settings-list-item__content">
                    <div class="settings-list-item__title">
                        ${item.name}
                        ${statusBadge}
                    </div>
                    <div class="settings-list-item__desc">
                        ID: ${item.id} · ${statusText}
                    </div>
                </div>
                <!-- 移除了单个操作按钮，保持界面整洁 -->
            </div>
        `;
    }

    private bindEvents() {
        // 1. 行点击事件 (代理 Checkbox 点击)
        const listItems = this.container.querySelectorAll('.settings-list-item');
        listItems.forEach(item => {
            this.addEventListener(item, 'click', (e) => {
                // 如果直接点击的是 checkbox，不处理（避免触发两次）
                if ((e.target as HTMLElement).matches('input[type="checkbox"]')) return;

                const checkbox = item.querySelector('.chk-item') as HTMLInputElement;
                checkbox.checked = !checkbox.checked;
                
                // 手动触发 change 事件逻辑
                this.handleItemSelection(checkbox);
            });
        });

        // 2. Checkbox Change 事件
        const checkboxes = this.container.querySelectorAll('.chk-item');
        checkboxes.forEach(chk => {
            this.addEventListener(chk, 'change', (e) => {
                this.handleItemSelection(e.target as HTMLInputElement);
            });
        });

        // 3. 分组全选/反选
        const selectAllChks = this.container.querySelectorAll('.chk-select-all');
        selectAllChks.forEach(chk => {
            this.addEventListener(chk, 'change', (e) => {
                const target = e.target as HTMLInputElement;
                const groupType = target.dataset.group;
                const items = this.allItems.filter(i => i.type === groupType);
                
                items.forEach(item => {
                    const key = `${item.type}:${item.id}`;
                    if (target.checked) {
                        this.selectedItems.add(key);
                    } else {
                        this.selectedItems.delete(key);
                    }
                });
                this.render(); 
            });
        });

        // 4. 批量操作按钮
        const batchBtn = this.container.querySelector('#btn-batch-restore');
        if (batchBtn) {
            this.addEventListener(batchBtn, 'click', () => this.handleBatchRestore());
        }
    }

    private handleItemSelection(target: HTMLInputElement) {
        if (target.checked) {
            this.selectedItems.add(target.value);
        } else {
            this.selectedItems.delete(target.value);
        }
        this.refreshUIState();
    }

    private refreshUIState() {
        const btn = this.container.querySelector('#btn-batch-restore') as HTMLButtonElement;
        if (btn) {
            const count = this.selectedItems.size;
            btn.disabled = count === 0;
            btn.innerHTML = `🔄 重置选中项 (${count})`;
            
            // 动态改变按钮颜色：如果选中了包含“正常”的项目，显示为警告色，提示用户这是一个覆盖操作
            const hasNormalItems = this.getSelectedObjects().some(i => i.status === 'ok');
            if (hasNormalItems) {
                btn.classList.remove('settings-btn--primary');
                btn.classList.add('settings-btn--danger'); // 警示色
            } else {
                btn.classList.remove('settings-btn--danger');
                btn.classList.add('settings-btn--primary');
            }
        }
        
        ['connection', 'agent'].forEach(type => {
            const items = this.allItems.filter(i => i.type === type);
            this.updateSelectAllCheckboxState(type, items);
        });
        
        // 更新行的高亮状态
        const rows = this.container.querySelectorAll('.settings-list-item');
        rows.forEach(row => {
            const key = (row as HTMLElement).dataset.key!;
            if (this.selectedItems.has(key)) {
                row.classList.add('settings-list-item--selected');
            } else {
                row.classList.remove('settings-list-item--selected');
            }
        });
    }

    private updateSelectAllCheckboxState(type: string, items: RestorableItem[]) {
        const chk = this.container.querySelector(`.chk-select-all[data-group="${type}"]`) as HTMLInputElement;
        if (!chk || items.length === 0) return;

        const allSelected = items.every(i => this.selectedItems.has(`${i.type}:${i.id}`));
        const someSelected = items.some(i => this.selectedItems.has(`${i.type}:${i.id}`));

        chk.checked = allSelected;
        chk.indeterminate = someSelected && !allSelected;
    }

    // 辅助方法：获取选中的实际对象
    private getSelectedObjects(): RestorableItem[] {
        return this.allItems.filter(item => 
            this.selectedItems.has(`${item.type}:${item.id}`)
        );
    }

    private handleBatchRestore() {
        if (this.selectedItems.size === 0) return;

        const selectedObjs = this.getSelectedObjects();
        const normalItems = selectedObjs.filter(i => i.status === 'ok');
        const modifiedItems = selectedObjs.filter(i => i.status === 'modified');
        const missingItems = selectedObjs.filter(i => i.status === 'missing');

        // 构建智能提示信息
        let msg = `确定要重置这 ${selectedObjs.length} 个项目吗？\n`;
        
        if (normalItems.length > 0) {
            msg += `\n⚠️ 注意：包含 ${normalItems.length} 个状态正常的项目。强制重置将覆盖当前的配置。`;
        }
        if (modifiedItems.length > 0) {
             msg += `\n⚠️ 警告：${modifiedItems.length} 个项目的自定义修改将丢失。`;
        }
        if (missingItems.length > 0) {
            msg += `\n✅ ${missingItems.length} 个丢失的项目将被恢复。`;
        }
        
        // 针对 Connection，额外提示 API Key
        const hasConnections = selectedObjs.some(i => i.type === 'connection');
        if (hasConnections) {
            msg += `\n\n(注：重置 Connection 时会尝试保留现有的 API Key)`;
        }

        Modal.confirm(
            normalItems.length > 0 ? '强制重置确认' : '恢复确认', 
            msg, 
            async () => {
                const btn = this.container.querySelector('#btn-batch-restore') as HTMLButtonElement;
                if(btn) {
                    btn.disabled = true;
                    btn.innerHTML = '⏳ 处理中...';
                }

                let successCount = 0;
                let errorCount = 0;
                const errors: string[] = [];

                const tasks = Array.from(this.selectedItems).map(async (key) => {
                    const [type, id] = key.split(':');
                    try {
                        await this.service.restoreItem(type as 'connection' | 'agent', id);
                        successCount++;
                    } catch (e: any) {
                        errorCount++;
                        errors.push(`${type}/${id}: ${e.message}`);
                    }
                });

                try {
                    await Promise.all(tasks);

                    if (errorCount === 0) {
                        Toast.success(`成功处理 ${successCount} 个项目`);
                        this.selectedItems.clear();
                    } else {
                        Toast.warning(`完成: ${successCount} 成功, ${errorCount} 失败`);
                        console.error('Restore errors:', errors);
                    }
                } catch (e) {
                    Toast.error('操作发生未知错误');
                } finally {
                    await this.render();
                }
            }
        );
    }
}