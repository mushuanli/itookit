// @file: app-settings/editors/RecoverySettingsEditor.ts

import { BaseSettingsEditor, Toast, Modal, type RestorableItem } from '@itookit/common';
import { IAgentManagementService } from '@itookit/llm-engine';

export class RecoverySettingsEditor extends BaseSettingsEditor<IAgentManagementService> {
    private selectedItems = new Set<string>(); // key = "type:id"
    private allItems: RestorableItem[] = [];

    async render() {
        this.allItems = await this.service.getRestorableItems();

        const providers   = this.allItems.filter(i => i.type === 'provider');
        const connections = this.allItems.filter(i => i.type === 'connection');
        const agents      = this.allItems.filter(i => i.type === 'agent');

        const selectedCount = this.selectedItems.size;
        const hasSelection  = selectedCount > 0;

        this.container.innerHTML = `
            <div class="settings-page">
                <div class="settings-page__header">
                    <div>
                        <h2 class="settings-page__title">系统恢复与维护</h2>
                        <p class="settings-page__description">
                            选中项目并点击「重置选中项」可将其恢复为出厂默认值。
                            Provider 重置会保留已配置的 API Key。
                        </p>
                    </div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
                        <button id="btn-reset-all" class="settings-btn settings-btn--danger">
                            🔄 强制全量重置
                        </button>
                        <button id="btn-batch-restore" class="settings-btn settings-btn--primary"
                                ${!hasSelection ? 'disabled' : ''}>
                            ↩️ 重置选中项 (${selectedCount})
                        </button>
                    </div>
                </div>

                ${this.renderSection('🏭 Provider 配置', 'provider', providers)}
                ${this.renderSection('🔗 默认连接（Connection）', 'connection', connections)}
                ${this.renderSection('🤖 默认智能体（Agent）', 'agent', agents)}
            </div>
        `;

        this.updateAllSelectAllState(providers, connections, agents);
        this.bindEvents();
    }

    // ── Render ─────────────────────────────────────────────────────────────────

    private renderSection(title: string, group: string, items: RestorableItem[]): string {
        return `
            <div class="recovery-section" style="margin-top:1.5rem">
                <div class="settings-section-header">
                    <h3 class="settings-section-title">${title}</h3>
                    <label class="settings-checkbox-label">
                        <input type="checkbox" class="chk-select-all" data-group="${group}"> 全选
                    </label>
                </div>
                <div class="settings-list-group">
                    ${items.length > 0
                        ? items.map(item => this.renderRow(item)).join('')
                        : '<div style="padding:12px;color:var(--st-text-disabled)">（无条目）</div>'
                    }
                </div>
            </div>
        `;
    }

    private renderRow(item: RestorableItem): string {
        const key = `${item.type}:${item.id}`;
        const isSelected = this.selectedItems.has(key);

        const { badge, cls } = {
            missing:  { badge: '<span class="settings-badge settings-badge--danger">已丢失</span>',  cls: 'status-missing' },
            modified: { badge: '<span class="settings-badge settings-badge--warning">已修改</span>', cls: 'status-modified' },
            ok:       { badge: '<span class="settings-badge settings-badge--success">正常</span>',   cls: 'status-ok' },
        }[item.status];

        return `
            <div class="settings-list-item ${cls}${isSelected ? ' settings-list-item--selected' : ''}"
                 data-key="${key}">
                <div class="settings-list-item__check">
                    <input type="checkbox" class="chk-item" value="${key}" ${isSelected ? 'checked' : ''}>
                </div>
                <div class="settings-list-item__icon">${item.icon ?? ''}</div>
                <div class="settings-list-item__content">
                    <div class="settings-list-item__title">${item.name} ${badge}</div>
                    <div class="settings-list-item__desc">${item.description ?? ''} · ID: ${item.id}</div>
                </div>
            </div>
        `;
    }

    // ── Events ─────────────────────────────────────────────────────────────────

    private bindEvents() {
        // Row click → toggle checkbox
        this.container.querySelectorAll('.settings-list-item').forEach(item => {
            this.addEventListener(item, 'click', (e) => {
                if ((e.target as HTMLElement).matches('input[type="checkbox"]')) return;
                const chk = item.querySelector('.chk-item') as HTMLInputElement;
                chk.checked = !chk.checked;
                this.handleItemSelection(chk);
            });
        });

        // Checkbox change
        this.container.querySelectorAll('.chk-item').forEach(chk => {
            this.addEventListener(chk, 'change', (e) =>
                this.handleItemSelection(e.target as HTMLInputElement));
        });

        // Group select-all
        this.container.querySelectorAll('.chk-select-all').forEach(chk => {
            this.addEventListener(chk, 'change', (e) => {
                const target = e.target as HTMLInputElement;
                const group = target.dataset.group!;
                this.allItems.filter(i => i.type === group).forEach(item => {
                    const key = `${item.type}:${item.id}`;
                    target.checked ? this.selectedItems.add(key) : this.selectedItems.delete(key);
                });
                this.render();
            });
        });

        // Batch restore
        const batchBtn = this.container.querySelector('#btn-batch-restore');
        if (batchBtn) this.addEventListener(batchBtn, 'click', () => this.handleBatchRestore());

        // Force reset all
        const resetAllBtn = this.container.querySelector('#btn-reset-all');
        if (resetAllBtn) this.addEventListener(resetAllBtn, 'click', () => this.handleResetAll());
    }

    private handleItemSelection(target: HTMLInputElement) {
        target.checked ? this.selectedItems.add(target.value) : this.selectedItems.delete(target.value);
        this.refreshUIState();
    }

    private refreshUIState() {
        const btn = this.container.querySelector('#btn-batch-restore') as HTMLButtonElement | null;
        if (btn) {
            const count = this.selectedItems.size;
            btn.disabled = count === 0;
            btn.innerHTML = `↩️ 重置选中项 (${count})`;
            const hasNormal = this.getSelectedObjects().some(i => i.status === 'ok');
            btn.classList.toggle('settings-btn--danger', hasNormal);
            btn.classList.toggle('settings-btn--primary', !hasNormal);
        }

        // Update select-all checkboxes
        ['provider', 'connection', 'agent'].forEach(type => {
            const items = this.allItems.filter(i => i.type === type);
            const chk = this.container.querySelector(`.chk-select-all[data-group="${type}"]`) as HTMLInputElement | null;
            if (!chk || items.length === 0) return;
            const allSel  = items.every(i => this.selectedItems.has(`${i.type}:${i.id}`));
            const someSel = items.some(i => this.selectedItems.has(`${i.type}:${i.id}`));
            chk.checked = allSel;
            chk.indeterminate = someSel && !allSel;
        });

        // Row highlight
        this.container.querySelectorAll('.settings-list-item').forEach(row => {
            const key = (row as HTMLElement).dataset.key!;
            row.classList.toggle('settings-list-item--selected', this.selectedItems.has(key));
        });
    }

    private updateAllSelectAllState(
        providers: RestorableItem[],
        connections: RestorableItem[],
        agents: RestorableItem[],
    ) {
        [
            ['provider', providers],
            ['connection', connections],
            ['agent', agents],
        ].forEach(([type, items]) => {
            const chk = this.container.querySelector(
                `.chk-select-all[data-group="${type}"]`
            ) as HTMLInputElement | null;
            const list = items as RestorableItem[];
            if (!chk || list.length === 0) return;
            const allSel  = list.every(i => this.selectedItems.has(`${i.type}:${i.id}`));
            const someSel = list.some(i => this.selectedItems.has(`${i.type}:${i.id}`));
            chk.checked = allSel;
            chk.indeterminate = someSel && !allSel;
        });
    }

    private getSelectedObjects(): RestorableItem[] {
        return this.allItems.filter(i => this.selectedItems.has(`${i.type}:${i.id}`));
    }

    // ── Actions ─────────────────────────────────────────────────────────────────

    private handleBatchRestore() {
        if (this.selectedItems.size === 0) return;

        const selected = this.getSelectedObjects();
        const hasOk    = selected.some(i => i.status === 'ok');
        const hasProviders = selected.some(i => i.type === 'provider');

        let msg = `确定要重置这 ${selected.length} 个项目吗？`;
        if (hasOk) msg += '\n\n⚠️ 注意：包含状态正常的项目，重置将覆盖当前配置。';
        if (hasProviders) msg += '\n\n✅ Provider 重置会保留已配置的 API Key，仅重置模型列表和地址。';

        Modal.confirm(hasOk ? '强制重置确认' : '恢复确认', msg, async () => {
            const btn = this.container.querySelector('#btn-batch-restore') as HTMLButtonElement;
            if (btn) { btn.disabled = true; btn.innerHTML = '⏳ 处理中...'; }

            let ok = 0; let err = 0;
            await Promise.all(
                Array.from(this.selectedItems).map(async (key) => {
                    const [type, id] = key.split(':');
                    try {
                        await this.service.restoreItem(
                            type as 'provider' | 'connection' | 'agent', id
                        );
                        ok++;
                    } catch (e: unknown) {
                        err++;
                        console.error(`Restore ${key}:`, e);
                    }
                })
            );

            if (err === 0) {
                Toast.success(`成功重置 ${ok} 个项目`);
                this.selectedItems.clear();
            } else {
                Toast.warning(`完成：${ok} 成功，${err} 失败`);
            }
            await this.render();
        });
    }

    private handleResetAll() {
        Modal.confirm(
            '强制全量重置',
            '将所有内置 Provider、Connection、Agent 恢复为出厂默认值。\n\n' +
            '✅ Provider 的 API Key 会被保留。\n' +
            '⚠️ 用户对模型列表、地址、Agent 配置的自定义修改将丢失。\n\n' +
            '建议在遇到配置混乱或版本升级后使用此功能。',
            async () => {
                const btn = this.container.querySelector('#btn-reset-all') as HTMLButtonElement;
                if (btn) { btn.disabled = true; btn.innerHTML = '⏳ 重置中...'; }
                try {
                    await this.service.resetAllDefaults();
                    Toast.success('已完成全量重置');
                    this.selectedItems.clear();
                } catch (e: unknown) {
                    Toast.error('重置失败：' + (e instanceof Error ? e.message : String(e)));
                } finally {
                    await this.render();
                }
            }
        );
    }
}
