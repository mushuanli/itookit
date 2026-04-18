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

        // enabled first, then disabled; within each group alphabetically
        connections.sort((a, b) => {
            const aOn = a.enabled !== false;
            const bOn = b.enabled !== false;
            if (aOn && !bOn) return -1;
            if (!aOn && bOn) return 1;
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
        const isDefault    = conn.id === 'default';
        const hasKey       = conn.hasApiKey;
        const enabled      = conn.enabled !== false;
        const pid          = conn.providerId ?? conn.provider;
        const provider     = this.providers[pid];
        const statusClass  = !hasKey ? 'settings-connection-card--incomplete' : '';
        const disabledStyle = enabled ? '' : 'opacity:0.55;';

        let badgeHtml = '';
        if (isDefault) {
            badgeHtml = '<span class="settings-badge settings-badge--success">默认</span>';
        } else if (!hasKey) {
            badgeHtml = '<span class="settings-badge settings-badge--warning">需配置</span>';
        }

        return `
            <div class="settings-connection-card ${isDefault ? 'settings-connection-card--default' : ''} ${statusClass}"
                 data-id="${conn.id}" data-name="${conn.name}" style="${disabledStyle}">
                <div class="settings-connection-card__header">
                    <h3 class="settings-connection-card__title">${conn.name}</h3>
                    <div style="display:flex;gap:4px;align-items:center">
                        ${badgeHtml}
                        <label class="llm-enable-toggle" title="${enabled ? '点击禁用' : '点击启用'}">
                            <input type="checkbox" class="chk-conn-enabled" data-id="${conn.id}"
                                   ${enabled ? 'checked' : ''} style="display:none">
                            <span class="llm-enable-toggle__track ${enabled ? 'llm-enable-toggle__track--on' : ''}">
                                <span class="llm-enable-toggle__thumb"></span>
                            </span>
                        </label>
                    </div>
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
                    <button class="settings-btn settings-btn--secondary settings-btn--sm settings-btn-edit" style="flex:1">✏️ 编辑</button>
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
            // Enable/disable toggle
            this.addEventListener(list, 'change', async (e) => {
                const target = e.target as HTMLInputElement;
                if (!target.classList.contains('chk-conn-enabled')) return;
                const id = target.dataset.id!;
                const full = await this.service.getFullConnection(id);
                if (!full) return;
                await this.service.saveConnection({ ...full, enabled: target.checked });
                this.render();
            });

            this.addEventListener(list, 'click', async (e) => {
                const target = e.target as HTMLElement;
                if (target.closest('.llm-enable-toggle')) return;  // handled by change
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

        this.currentEditTiers = connection?.tiers ? { ...connection.tiers } : {};

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
                           value="${connection?.name || ''}" required
                           placeholder="例如: RDSec-Claude、RDSec-Gemini">
                    <small class="settings-form__help">
                        同一 Provider 可创建多个连接，用于配置不同的模型层级组合。
                    </small>
                </div>

                <!-- Tier configuration (Connection's core responsibility) -->
                <div class="settings-form__group">
                    <label class="settings-form__label" style="display:flex;align-items:center;gap:6px">
                        模型层级配置
                        <span class="settings-help-icon"
                              title="为此连接指定各层级使用的模型：&#10;• 最优（optimal）— 复杂推理（必填）&#10;• 标准（standard）— 日常工作&#10;• 快速（fast）— 简单廉价任务&#10;预算超过 80% 时系统自动向下降级。">?</span>
                    </label>
                    <div class="settings-tier-config" id="tier-config-section">
                        ${this.renderTierForm(initialProvider)}
                    </div>
                    <small class="settings-form__help">
                        API Key 和模型列表在 <strong>设置 → LLM Providers</strong> 中管理。
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

                // Read all three tier selections
                const tierOptimal  = (document.getElementById('tier-optimal')  as HTMLSelectElement)?.value || '';
                const tierStandard = (document.getElementById('tier-standard') as HTMLSelectElement)?.value || '';
                const tierFast     = (document.getElementById('tier-fast')     as HTMLSelectElement)?.value || '';
                const tiers: Partial<Record<ModelTier, string>> = {};
                if (tierOptimal)  tiers.optimal  = tierOptimal;
                if (tierStandard) tiers.standard = tierStandard;
                if (tierFast)     tiers.fast     = tierFast;

                const newConn: LLMConnection = {
                    id: connection?.id || `conn-${generateShortUUID()}`,
                    name: data.name,
                    providerId: pid,
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

    /** 渲染 tier 配置三行（optimal/standard/fast 全部可选） */
    private renderTierForm(provider: LLMProvider | undefined): string {
        const models = provider?.models ?? [];
        const noneOpt = '<option value="">— 未指定（使用 Provider 首个模型）—</option>';
        const modelOpts = models.map(m =>
            `<option value="${m.id}">${m.name}</option>`
        ).join('');

        const sel = (id: string, _tier: ModelTier) => `
            <select class="settings-form__select settings-form__select--sm" id="${id}" style="flex:1">
                ${noneOpt}${modelOpts}
            </select>`;

        return `
            <div class="settings-tier-row">
                <span class="settings-tier-badge settings-tier-badge--optimal">最优</span>
                ${sel('tier-optimal', 'optimal')}
            </div>
            <div class="settings-tier-row">
                <span class="settings-tier-badge settings-tier-badge--standard">标准</span>
                ${sel('tier-standard', 'standard')}
            </div>
            <div class="settings-tier-row">
                <span class="settings-tier-badge settings-tier-badge--fast">快速</span>
                ${sel('tier-fast', 'fast')}
            </div>
        `;
    }

    private bindModalEvents(connection: LLMConnection | null, initialPid: string) {
        const providerSelect = document.getElementById('conn-provider') as HTMLSelectElement | null;
        const tierSection    = document.getElementById('tier-config-section') as HTMLElement | null;

        const refreshTierSelects = (provider: LLMProvider | undefined, tiers: Partial<Record<ModelTier, string>>) => {
            if (!tierSection) return;
            tierSection.innerHTML = this.renderTierForm(provider);
            const optSel  = document.getElementById('tier-optimal')  as HTMLSelectElement | null;
            const stdSel  = document.getElementById('tier-standard') as HTMLSelectElement | null;
            const fastSel = document.getElementById('tier-fast')     as HTMLSelectElement | null;
            if (optSel  && tiers.optimal)  optSel.value  = tiers.optimal;
            if (stdSel  && tiers.standard) stdSel.value  = tiers.standard;
            if (fastSel && tiers.fast)     fastSel.value = tiers.fast;
        };

        // Initialize tier selects with current connection tiers
        const initTiers = connection?.tiers ?? {};
        refreshTierSelects(this.providers[initialPid], initTiers);

        // Provider switch → refresh tier selects
        providerSelect?.addEventListener('change', () => {
            const provider = this.providers[providerSelect.value];
            this.currentEditTiers = {};
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
