// @file: llm-ui/editors/ConnectionSettingsEditor.ts
//
// 三层架构：Provider → Connection → Agent
// 此编辑器负责 Connection 层：绑定 Provider + 配置 apiKey + 自定义 tier 映射。
// 模型目录由 Provider 统一管理，不在 Connection 中存储/编辑。

import { Modal, Toast, BaseSettingsEditor, generateShortUUID, ENTITY_ICONS } from '@itookit/common';
import type { IConnectionService, ConnectionMeta, LLMConnection, LLMProvider, ModelTier } from '@itookit/common';
import { fromConnectionDef, serializeLLMConfig } from '@itookit/device-llm';
import { runLLMImport } from './llm-import';

export class ConnectionSettingsEditor extends BaseSettingsEditor<IConnectionService> {
    private currentEditTiers: Partial<Record<ModelTier, string>> = {};
    private currentEditTierThinking: Partial<Record<ModelTier, boolean>> = {};
    private providers: Record<string, LLMProvider> = {};
    private _checkedIds = new Set<string>();

    async render() {
        this.providers = Object.fromEntries(
            this.service.getProviders().map(p => [p.id, p])
        );
        let connections = await this.service.getConnections();

        // enabled first, then disabled; within each group alphabetically
        connections.sort((a, b) => {
            const aOn = a.enabled !== false;
            const bOn = b.enabled !== false;
            if (aOn && !bOn) return -1;
            if (!aOn && bOn) return 1;
            return (a.name || '').localeCompare(b.name || '');
        });

        const checkedCount = this._checkedIds.size;

        this.container.innerHTML = `
            <div class="settings-page">
                <div class="settings-page__header">
                    <div>
                        <h2 class="settings-page__title">LLM 连接配置</h2>
                        <p class="settings-page__description">为云提供商配置 API Key，并设置模型层级（optimal / standard / fast）</p>
                    </div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
                        <input type="file" id="llm-conn-import-file"
                               accept=".llm,.yaml,.yml" multiple style="display:none">
                        <button id="btn-import-conn-llm" class="settings-btn settings-btn--secondary"
                                title="从 .llm 文件导入连接（和可选的 Provider 定义）">
                            ↑ 导入 .llm
                        </button>
                        <button id="btn-export-conn-llm" class="settings-btn settings-btn--secondary"
                                ${checkedCount === 0 ? 'disabled' : ''}
                                title="将选中连接导出为 .llm 文件">
                            ↓ 导出${checkedCount > 0 ? ` (${checkedCount})` : ''}
                        </button>
                        <button id="btn-delete-conn-batch" class="settings-btn settings-btn--danger"
                                ${checkedCount === 0 ? 'disabled' : ''}
                                title="删除选中的连接（默认连接不可删除）">
                            🗑️ 删除${checkedCount > 0 ? ` (${checkedCount})` : ''}
                        </button>
                        <button id="btn-add-connection" class="settings-btn settings-btn--primary">
                            <span class="settings-btn__icon">+</span> 添加连接
                        </button>
                    </div>
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

        const isChecked = this._checkedIds.has(conn.id);

        return `
            <div class="settings-connection-card ${isDefault ? 'settings-connection-card--default' : ''} ${statusClass}"
                 data-id="${conn.id}" data-name="${conn.name}" style="${disabledStyle}">
                <div class="settings-connection-card__header">
                    <div style="display:flex;align-items:center;gap:6px;min-width:0">
                        <input type="checkbox" class="chk-conn-select" data-id="${conn.id}"
                               ${isChecked ? 'checked' : ''}
                               title="选中以批量导出"
                               style="flex-shrink:0;cursor:pointer;width:15px;height:15px">
                        <h3 class="settings-connection-card__title"
                            style="margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                            ${conn.name}
                        </h3>
                    </div>
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
        this.bindButton('#btn-import-conn-llm', () => {
            (this.container.querySelector('#llm-conn-import-file') as HTMLInputElement)?.click();
        });
        this.bindButton('#btn-export-conn-llm', () => this.exportSelected());
        this.bindButton('#btn-delete-conn-batch', () => this.batchDelete());

        const fileInput = this.container.querySelector('#llm-conn-import-file') as HTMLInputElement | null;
        if (fileInput) {
            this.addEventListener(fileInput, 'change', async () => {
                if (fileInput.files?.length) {
                    await this.importLLMFiles(fileInput.files);
                    fileInput.value = '';
                }
            });
        }

        const list = this.container.querySelector('#connections-list');
        if (list) {
            this.addEventListener(list, 'change', async (e) => {
                const target = e.target as HTMLInputElement;

                // Multi-select checkbox
                if (target.classList.contains('chk-conn-select')) {
                    const id = target.dataset.id!;
                    if (target.checked) this._checkedIds.add(id);
                    else this._checkedIds.delete(id);
                    const count = this._checkedIds.size;
                    const exportBtn = this.container.querySelector('#btn-export-conn-llm') as HTMLButtonElement | null;
                    if (exportBtn) { exportBtn.disabled = count === 0; exportBtn.textContent = `↓ 导出${count > 0 ? ` (${count})` : ''}`; }
                    const deleteBtn = this.container.querySelector('#btn-delete-conn-batch') as HTMLButtonElement | null;
                    if (deleteBtn) { deleteBtn.disabled = count === 0; deleteBtn.textContent = `🗑️ 删除${count > 0 ? ` (${count})` : ''}`; }
                    return;
                }

                // Enable/disable toggle
                if (target.classList.contains('chk-conn-enabled')) {
                    const id = target.dataset.id!;
                    const full = await this.service.getFullConnection(id);
                    if (!full) return;
                    await this.service.saveConnection({ ...full, enabled: target.checked });
                    this.render();
                }
            });

            this.addEventListener(list, 'click', async (e) => {
                const target = e.target as HTMLElement;
                if (target.closest('.llm-enable-toggle') || target.classList.contains('chk-conn-select')) return;
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

    // ── Import / Export ────────────────────────────────────────────────────────

    private async importLLMFiles(files: FileList): Promise<void> {
        const imported = await runLLMImport(files, this.service);
        if (imported) this.render();
    }

    private async exportSelected(): Promise<void> {
        const ids = [...this._checkedIds];
        if (!ids.length) return;

        const allConns = await this.service.getConnections();
        const selected = allConns.filter(c => ids.includes(c.id));
        const connDefs = selected.map(c =>
            fromConnectionDef({ id: c.id, name: c.name, providerId: c.providerId, tiers: c.tiers }),
        );

        const yaml = serializeLLMConfig({ connections: connDefs });
        const filename = selected.length === 1 ? `${selected[0].id}.llm` : 'connections-export.llm';
        const blob = new Blob([yaml], { type: 'text/yaml' });
        const a = Object.assign(document.createElement('a'), {
            href: URL.createObjectURL(blob), download: filename,
        });
        a.click();
        URL.revokeObjectURL(a.href);
    }

    private async batchDelete(): Promise<void> {
        const ids = [...this._checkedIds];
        if (!ids.length) return;

        const allConns = await this.service.getConnections();
        // Default connection cannot be deleted
        const deletable = allConns.filter(c => ids.includes(c.id) && c.id !== 'default');
        const skipped   = ids.length - deletable.length;

        if (!deletable.length) {
            Toast.error('选中的连接均不可删除（默认连接不可删除）');
            return;
        }

        const names = deletable.map(c => `「${c.name}」`).join('、');
        const hint  = skipped > 0 ? `\n（另有 ${skipped} 个默认连接将跳过）` : '';

        Modal.confirm(
            '批量删除连接',
            `确定删除 ${names}？此操作不可撤销。${hint}`,
            async () => {
                for (const c of deletable) {
                    await this.service.deleteConnection(c.id);
                }
                this._checkedIds.clear();
                Toast.success(`已删除 ${deletable.length} 个连接`);
                this.render();
            },
        );
    }

    // ── Edit modal ─────────────────────────────────────────────────────────────

    private showEditModal(connection: LLMConnection | null) {
        const isNew = !connection;
        const providerKeys = Object.keys(this.providers);
        const initialPid = connection?.providerId ?? connection?.provider ?? providerKeys[0];
        const initialProvider = this.providers[initialPid] ?? this.providers[providerKeys[0]];

        this.currentEditTiers = connection?.tiers ? { ...connection.tiers } : {};
        this.currentEditTierThinking = (connection?.metadata?.tierThinking as Record<string, boolean>) || {};

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

                <!-- Temperature override -->
                <div class="settings-form__group">
                    <label class="settings-form__label">温度 (0-2)</label>
                    <input type="number" class="settings-form__input" name="temperature"
                           value="${connection?.temperature ?? ''}"
                           min="0" max="2" step="0.1" placeholder="未设置（使用 Provider 默认）"
                           style="max-width:120px">
                    <small class="settings-form__help">
                        覆盖 Provider 的默认温度。留空则使用 Provider 设置。
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

                <!-- Reasoning Effort -->
                <div class="settings-form__group">
                    <label class="settings-form__label">推理强度</label>
                    <select class="settings-form__select" name="reasoningEffort" style="max-width:160px">
                        <option value="">未设置（默认 xhigh）</option>
                        <option value="low"    ${connection?.metadata?.reasoningEffort === 'low'    ? 'selected' : ''}>Low — 短思考</option>
                        <option value="medium" ${connection?.metadata?.reasoningEffort === 'medium' ? 'selected' : ''}>Medium — 中等思考</option>
                        <option value="xhigh"  ${connection?.metadata?.reasoningEffort === 'xhigh'  ? 'selected' : ''}>xHigh — 最深思考</option>
                    </select>
                    <small class="settings-form__help">
                        仅对支持 thinking 的模型生效（DeepSeek V4 Pro 等）。设置后自动带入请求。
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

                const tempVal = parseFloat(data.temperature);
                const reasoningEffort = data.reasoningEffort || undefined;
                const metadata: Record<string, unknown> = { ...(connection?.metadata ?? {}) };
                if (reasoningEffort) {
                    metadata.reasoningEffort = reasoningEffort;
                } else {
                    delete metadata.reasoningEffort;
                }
                // Per-tier thinking overrides (only store explicit overrides)
                const tierThinking: Record<string, boolean> = {};
                for (const [tier, enabled] of Object.entries(this.currentEditTierThinking)) {
                    if (enabled !== undefined) tierThinking[tier] = enabled;
                }
                if (Object.keys(tierThinking).length > 0) {
                    metadata.tierThinking = tierThinking;
                } else {
                    delete metadata.tierThinking;
                }
                const newConn: LLMConnection = {
                    id: connection?.id || `conn-${generateShortUUID()}`,
                    name: data.name,
                    providerId: pid,
                    tiers: Object.keys(tiers).length > 0 ? tiers : undefined,
                    temperature: !isNaN(tempVal) ? tempVal : undefined,
                    dailyCosts: connection?.dailyCosts,
                    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
                };

                await this.service.saveConnection(newConn);
                Toast.success('连接配置已保存');
                this.render();
            },
        }).show();

        setTimeout(() => this.bindModalEvents(connection, initialPid), 100);
    }

    /** 渲染单个 tier 的 thinking 开关 HTML（有 modelId 时显示，否则返回空字符串） */
    private renderTierThinkingToggle(tier: ModelTier, modelId: string, thinkingOn: boolean): string {
        if (!modelId) return '';
        const title = thinkingOn ? '关闭思考' : '开启思考';
        return `
            <label class="llm-enable-toggle" title="${title}" style="margin-left:8px;display:flex;align-items:center;gap:4px;cursor:pointer;font-size:0.75rem;">
                <input type="checkbox" class="chk-tier-thinking" data-tier="${tier}" ${thinkingOn ? 'checked' : ''} style="display:none">
                <span class="llm-enable-toggle__track ${thinkingOn ? 'llm-enable-toggle__track--on' : ''}" style="width:32px;height:18px;">
                    <span class="llm-enable-toggle__thumb"></span>
                </span>
                <span style="font-size:12px;">${ENTITY_ICONS.llm}</span>
            </label>`;
    }

    /** 渲染 tier 配置三行（optimal/standard/fast 全部可选），每行带 thinking 开关 */
    private renderTierForm(provider: LLMProvider | undefined): string {
        const models = provider?.models ?? [];
        const noneOpt = '<option value="">— 未指定（使用 Provider 首个模型）—</option>';
        const modelOpts = models.map(m =>
            `<option value="${m.id}">${m.name}</option>`
        ).join('');

        const tierRow = (tier: ModelTier, label: string, badgeClass: string) => {
            const modelId = this.currentEditTiers[tier] || '';
            const modelDef = models.find(m => m.id === modelId);
            const thinkingOn = this.currentEditTierThinking[tier] ??
                (modelDef?.supportsThinking ?? false);

            return `
                <div class="settings-tier-row">
                    <span class="settings-tier-badge ${badgeClass}">${label}</span>
                    <select class="settings-form__select settings-form__select--sm" id="tier-${tier}" data-tier="${tier}" style="flex:1">${noneOpt}${modelOpts}</select>
                    <div class="tier-thinking-slot" id="tier-thinking-${tier}">${this.renderTierThinkingToggle(tier, modelId, thinkingOn)}</div>
                </div>`;
        };

        return `
            ${tierRow('optimal',  '最优', 'settings-tier-badge--optimal')}
            ${tierRow('standard', '标准', 'settings-tier-badge--standard')}
            ${tierRow('fast',     '快速', 'settings-tier-badge--fast')}
        `;
    }

    private bindModalEvents(connection: LLMConnection | null, initialPid: string) {
        const providerSelect = document.getElementById('conn-provider') as HTMLSelectElement | null;
        const tierSection    = document.getElementById('tier-config-section') as HTMLElement | null;

        const refreshTierThinkingSlot = (tier: ModelTier, provider: LLMProvider | undefined) => {
            const slot = document.getElementById(`tier-thinking-${tier}`);
            if (!slot) return;
            const modelId = this.currentEditTiers[tier] ?? '';
            const modelDef = provider?.models.find(m => m.id === modelId);
            const thinkingOn = this.currentEditTierThinking[tier] ??
                (modelDef?.supportsThinking ?? false);
            slot.innerHTML = this.renderTierThinkingToggle(tier, modelId, thinkingOn);
        };

        const refreshTierSelects = (provider: LLMProvider | undefined, tiers: Partial<Record<ModelTier, string>>) => {
            if (!tierSection) return;
            tierSection.innerHTML = this.renderTierForm(provider);
            const optSel  = document.getElementById('tier-optimal')  as HTMLSelectElement | null;
            const stdSel  = document.getElementById('tier-standard') as HTMLSelectElement | null;
            const fastSel = document.getElementById('tier-fast')     as HTMLSelectElement | null;
            if (optSel  && tiers.optimal)  optSel.value  = tiers.optimal;
            if (stdSel  && tiers.standard) stdSel.value  = tiers.standard;
            if (fastSel && tiers.fast)     fastSel.value = tiers.fast;
            // Refresh thinking slots for tiers that have preselected models
            for (const t of ['optimal', 'standard', 'fast'] as ModelTier[]) {
                if (tiers[t]) refreshTierThinkingSlot(t, provider);
            }
        };

        // Initialize tier selects with current connection tiers
        const initTiers = connection?.tiers ?? {};
        refreshTierSelects(this.providers[initialPid], initTiers);

        // Single delegated handler for all tier-section changes.
        tierSection?.addEventListener('change', (e) => {
            const target = e.target as HTMLElement;
            const sel = target.closest('select[data-tier]') as HTMLSelectElement | null;
            if (sel) {
                const tier = sel.dataset.tier as ModelTier;
                this.currentEditTiers[tier] = sel.value || undefined;
                if (!sel.value) delete this.currentEditTierThinking[tier];
                const pid = providerSelect?.value || initialPid;
                refreshTierThinkingSlot(tier, this.providers[pid]);
                return;
            }
            const chk = target.closest('.chk-tier-thinking') as HTMLInputElement | null;
            if (chk?.dataset.tier) {
                const tier = chk.dataset.tier as ModelTier;
                this.currentEditTierThinking[tier] = chk.checked;
                const pid = providerSelect?.value || initialPid;
                refreshTierThinkingSlot(tier, this.providers[pid]);
            }
        });

        // Provider switch → refresh tier selects
        providerSelect?.addEventListener('change', () => {
            const provider = this.providers[providerSelect.value];
            this.currentEditTiers = {};
            this.currentEditTierThinking = {};
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
