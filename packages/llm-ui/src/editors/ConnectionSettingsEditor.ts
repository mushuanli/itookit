// @file: llm-ui/editors/ConnectionSettingsEditor.ts
//
// 三层架构：Provider → Connection → Agent
// 此编辑器负责 Connection 层：绑定 Provider + 配置 apiKey + 自定义 tier 映射。
// 模型目录由 Provider 统一管理，不在 Connection 中存储/编辑。

import { Modal, Toast, BaseSettingsEditor, generateShortUUID } from '@itookit/common';
import type { IConnectionService, ConnectionMeta, LLMConnection, LLMProvider, ModelTier } from '@itookit/common';

export class ConnectionSettingsEditor extends BaseSettingsEditor<IConnectionService> {
    private currentEditTiers: Partial<Record<ModelTier, string>> = {};
    private providers: Record<string, LLMProvider> = {};

    async render() {
        this.providers = this.service.getProviderDefaults();
        let connections = await this.service.getConnections();

        connections.sort((a, b) => {
            if (a.id === 'default') return -1;
            if (b.id === 'default') return 1;
            if (a.hasApiKey && !b.hasApiKey) return -1;
            if (!a.hasApiKey && b.hasApiKey) return 1;
            return (a.name || '').localeCompare(b.name || '');
        });

        this.container.innerHTML = `
            <div class="settings-page">
                <div class="settings-page__header">
                    <div>
                        <h2 class="settings-page__title">LLM 连接配置</h2>
                        <p class="settings-page__description">为云提供商配置 API Key，并设置模型层级（optimal / standard / fast）</p>
                    </div>
                    <button id="btn-add-connection" class="settings-btn settings-btn--primary">
                        <span class="settings-btn__icon">+</span> 添加连接
                    </button>
                </div>

                <div id="connections-list" class="settings-connection-grid">
                    ${connections.map(conn => this.renderConnectionCard(conn)).join('')}
                </div>

                ${connections.length === 0 ? `
                    <div class="settings-empty">
                        <div class="settings-empty__icon">🔌</div>
                        <h3 class="settings-empty__title">还没有配置连接</h3>
                        <p class="settings-empty__text">点击"添加连接"按钮，选择云提供商并填写 API Key</p>
                    </div>
                ` : ''}
            </div>
        `;

        this.bindEvents();
    }

    // ── Card rendering ─────────────────────────────────────────────────────────

    private renderConnectionCard(conn: ConnectionMeta) {
        const isDefault = conn.id === 'default';
        const hasKey = conn.hasApiKey;
        const pid = conn.providerId ?? conn.provider;
        const provider = this.providers[pid];
        const statusClass = !hasKey ? 'settings-connection-card--incomplete' : '';

        let badgeHtml = '';
        if (isDefault) {
            badgeHtml = '<span class="settings-badge settings-badge--success">默认</span>';
        } else if (!hasKey) {
            badgeHtml = '<span class="settings-badge settings-badge--warning">需配置</span>';
        }

        const editBtnText = hasKey ? '✏️ 编辑' : '⚙️ 去配置';
        const editBtnClass = hasKey ? 'settings-btn--secondary' : 'settings-btn--primary';

        return `
            <div class="settings-connection-card ${isDefault ? 'settings-connection-card--default' : ''} ${statusClass}"
                 data-id="${conn.id}" data-name="${conn.name}">
                <div class="settings-connection-card__header">
                    <h3 class="settings-connection-card__title">${conn.name}</h3>
                    ${badgeHtml}
                </div>

                <div class="settings-connection-card__details">
                    <div class="settings-detail-item">
                        <span class="settings-detail-item__label">提供商</span>
                        <span class="settings-detail-item__value">${provider?.icon ?? ''} ${provider?.name ?? pid}</span>
                    </div>
                    <div class="settings-detail-item">
                        <span class="settings-detail-item__label">最优模型</span>
                        <span class="settings-detail-item__value">${this.resolvedModelName(conn)}</span>
                    </div>
                    <div class="settings-detail-item">
                        <span class="settings-detail-item__label">成本层级</span>
                        <span class="settings-detail-item__value">${this.renderTierBadges(conn)}</span>
                    </div>
                    <div class="settings-detail-item">
                        <span class="settings-detail-item__label">Provider Key</span>
                        <span class="settings-detail-item__value">
                            ${hasKey
                                ? '<span style="color:var(--st-color-success,#10b981)">✓ 已配置</span>'
                                : '<span style="color:var(--st-text-disabled)">未配置（在 Providers 中设置）</span>'
                            }
                        </span>
                    </div>
                </div>

                <div class="settings-page__actions" style="margin-top:auto; width:100%">
                    <button class="settings-btn ${editBtnClass} settings-btn--sm settings-btn-edit" style="flex:1">${editBtnText}</button>
                    ${!isDefault ? '<button class="settings-btn settings-btn--danger settings-btn--sm settings-btn-delete" style="flex:1">🗑️ 删除</button>' : ''}
                </div>
            </div>
        `;
    }

    private resolvedModelName(conn: ConnectionMeta): string {
        const pid = conn.providerId ?? conn.provider;
        const provider = this.providers[pid];
        const modelId = conn.model;
        if (!modelId) return '未设置';
        const modelDef = provider?.models.find(m => m.id === modelId);
        return modelDef ? modelDef.name : modelId;
    }

    private renderTierBadges(conn: ConnectionMeta): string {
        const tiers = conn.tiers;
        if (!tiers || (!tiers.standard && !tiers.fast)) {
            return '<span style="color:var(--st-text-disabled)">未配置</span>';
        }
        const badges: string[] = ['<span class="settings-tier-badge settings-tier-badge--optimal">最优</span>'];
        if (tiers.standard) badges.push('<span class="settings-tier-badge settings-tier-badge--standard">标准</span>');
        if (tiers.fast)     badges.push('<span class="settings-tier-badge settings-tier-badge--fast">快速</span>');
        return badges.join(' ');
    }

    // ── Events ─────────────────────────────────────────────────────────────────

    private bindEvents() {
        this.clearListeners();
        this.bindButton('#btn-add-connection', () => this.showEditModal(null));

        const list = this.container.querySelector('#connections-list');
        if (list) {
            this.addEventListener(list, 'click', async (e) => {
                const target = e.target as HTMLElement;
                const card = target.closest('.settings-connection-card') as HTMLElement;
                if (!card) return;
                const id = card.dataset.id!;
                if (target.closest('.settings-btn-edit')) {
                    const connection = await this.service.getFullConnection(id);
                    this.showEditModal(connection ?? null);
                } else if (target.closest('.settings-btn-delete')) {
                    this.deleteConnection(id, card.dataset.name ?? id);
                }
            });
        }
    }

    // ── Edit modal ─────────────────────────────────────────────────────────────

    private showEditModal(connection: LLMConnection | null) {
        const isNew = !connection;
        const providerKeys = Object.keys(this.providers);
        const initialPid = connection?.providerId ?? connection?.provider ?? providerKeys[0];
        const initialProvider = this.providers[initialPid] ?? this.providers[providerKeys[0]];

        this.currentEditTiers = connection?.tiers
            ? { ...connection.tiers }
            : { ...initialProvider?.defaultTiers };

        const modalContent = `
            <form id="connection-form" class="settings-form">
                <!-- Provider selection (configure providers in "LLM Providers" settings) -->
                <div class="settings-form__group">
                    <label class="settings-form__label">云提供商 *</label>
                    <select class="settings-form__select" id="conn-provider" name="providerId" required>
                        ${providerKeys.map(k => {
                            const p = this.providers[k];
                            return `<option value="${k}" ${initialPid === k ? 'selected' : ''}>${p.icon ?? ''} ${p.name}</option>`;
                        }).join('')}
                    </select>
                    <small class="settings-form__help">
                        Provider 的模型列表和地址在
                        <strong>设置 → LLM Providers</strong> 中管理。
                    </small>
                </div>

                <!-- Connection name -->
                <div class="settings-form__group">
                    <label class="settings-form__label">连接名称 *</label>
                    <input type="text" class="settings-form__input" name="name"
                           value="${connection?.name || ''}" required placeholder="例如: 我的 Anthropic">
                </div>

                <!-- API Key hint -->
                <div class="settings-form__group">
                    <small class="settings-form__help" style="padding:8px;background:var(--st-bg-secondary);border-radius:4px;display:block">
                        🔑 API Key 在 <strong>设置 → LLM Providers</strong> 中配置，与所有绑定此 Provider 的连接共享。
                    </small>
                </div>

                <!-- Base URL override -->
                <div class="settings-form__group">
                    <label class="settings-form__label">Base URL <small>（可选，覆盖提供商默认地址）</small></label>
                    <input type="text" class="settings-form__input" id="conn-baseurl" name="baseURL"
                           value="${connection?.baseURL || ''}" placeholder="留空使用提供商默认地址">
                </div>

                <!-- Tier configuration -->
                <div class="settings-form__group">
                    <label class="settings-form__label" style="display:flex;align-items:center;gap:6px">
                        成本层级配置
                        <span class="settings-help-icon"
                              title="为同一连接设置不同成本的模型。&#10;• 最优（optimal）= 默认 / 高质量推理&#10;• 标准（standard）= 日常工作&#10;• 快速（fast）= 简单廉价任务&#10;预算超过 80% 时系统自动向下降级。">?</span>
                    </label>
                    <div class="settings-tier-config" id="tier-config-section">
                        ${this.renderTierForm(initialProvider, this.currentEditTiers)}
                    </div>
                    <small class="settings-form__help">
                        选择"— 同最优模型 —"表示不配置该层级（使用 optimal）。
                    </small>
                </div>
            </form>
        `;

        new Modal(isNew ? '添加连接' : '配置连接', modalContent, {
            width: '560px',
            confirmText: '保存',
            onConfirm: async () => {
                const form = document.getElementById('connection-form') as HTMLFormElement;
                if (!form.checkValidity()) { form.reportValidity(); return false; }

                const formData = new FormData(form);
                const data = Object.fromEntries(formData) as Record<string, string>;
                const pid = data.providerId;

                // Read current tier selections
                const tierStandard = (document.getElementById('tier-standard') as HTMLSelectElement)?.value || '';
                const tierFast     = (document.getElementById('tier-fast')     as HTMLSelectElement)?.value || '';
                const tiers: Partial<Record<ModelTier, string>> = {};
                if (tierStandard) tiers.standard = tierStandard;
                if (tierFast)     tiers.fast     = tierFast;

                const newConn: LLMConnection = {
                    id: connection?.id || `conn-${generateShortUUID()}`,
                    name: data.name,
                    providerId: pid,
                    // apiKey is on Provider, not Connection
                    tiers: Object.keys(tiers).length > 0 ? tiers : undefined,
                    metadata: connection?.metadata,
                };

                await this.service.saveConnection(newConn);
                Toast.success('连接配置已保存');
                this.render();
            },
        }).show();

        setTimeout(() => this.bindModalEvents(connection, initialPid), 100);
    }

    /** 渲染 tier 配置三行（optimal 只读说明 + standard/fast 下拉） */
    private renderTierForm(provider: LLMProvider | undefined, tiers: Partial<Record<ModelTier, string>>): string {
        const models = provider?.models ?? [];
        const noneOpt = '<option value="">— 同最优模型 —</option>';
        const modelOpts = models.map(m =>
            `<option value="${m.id}">${m.name}</option>`
        ).join('');

        const optimalModel = tiers.optimal
            ?? provider?.defaultTiers?.optimal
            ?? models[0]?.id
            ?? '';
        const optimalName = models.find(m => m.id === optimalModel)?.name ?? optimalModel ?? '（连接后自动解析）';

        return `
            <div class="settings-tier-row">
                <span class="settings-tier-badge settings-tier-badge--optimal">最优</span>
                <span class="settings-tier-label" style="flex:1">${optimalName}</span>
                <small style="color:var(--st-text-disabled)">默认</small>
            </div>
            <div class="settings-tier-row">
                <span class="settings-tier-badge settings-tier-badge--standard">标准</span>
                <select class="settings-form__select settings-form__select--sm" id="tier-standard" style="flex:1">
                    ${noneOpt}${modelOpts}
                </select>
            </div>
            <div class="settings-tier-row">
                <span class="settings-tier-badge settings-tier-badge--fast">快速</span>
                <select class="settings-form__select settings-form__select--sm" id="tier-fast" style="flex:1">
                    ${noneOpt}${modelOpts}
                </select>
            </div>
        `;
    }

    private bindModalEvents(connection: LLMConnection | null, initialPid: string) {
        const providerSelect = document.getElementById('conn-provider') as HTMLSelectElement | null;
        const tierSection    = document.getElementById('tier-config-section') as HTMLElement | null;

        const refreshTierSelects = (provider: LLMProvider | undefined, tiers: Partial<Record<ModelTier, string>>) => {
            if (!tierSection) return;
            tierSection.innerHTML = this.renderTierForm(provider, tiers);
            const stdSel  = document.getElementById('tier-standard') as HTMLSelectElement | null;
            const fastSel = document.getElementById('tier-fast')     as HTMLSelectElement | null;
            if (stdSel  && tiers.standard) stdSel.value  = tiers.standard;
            if (fastSel && tiers.fast)     fastSel.value = tiers.fast;
        };

        // Initialize tier selects with current connection tiers
        const initTiers = connection?.tiers ?? this.providers[initialPid]?.defaultTiers ?? {};
        refreshTierSelects(this.providers[initialPid], initTiers);

        // Provider switch → refresh tier selects
        providerSelect?.addEventListener('change', () => {
            const provider = this.providers[providerSelect.value];
            this.currentEditTiers = { ...provider?.defaultTiers };
            refreshTierSelects(provider, this.currentEditTiers);
        });
    }

    private deleteConnection(id: string, name: string) {
        Modal.confirm('确认删除', `确定要删除连接"${name}"吗？此操作无法撤销。`, async () => {
            await this.service.deleteConnection(id);
            Toast.success('连接已删除');
            this.render();
        });
    }

    private bindButton(selector: string, handler: () => void) {
        const btn = this.container.querySelector(selector);
        if (btn) this.addEventListener(btn, 'click', handler);
    }
}
