// @file: llm-ui/editors/ProviderSettingsEditor.ts
//
// Provider 配置编辑器（三层架构第一层）。
//
// 职责：
//   - 展示所有 Provider（内置 + 用户自定义）
//   - 编辑 Provider：name / icon / implementation / baseURL / apiKey / 模型列表
//   - 新建自定义 Provider（openai-compatible 端点）
//   - 重置内置 Provider 到默认值
//   - 删除用户自定义 Provider
//
// 注意：tier 配置（optimal/standard/fast 映射）属于 Connection 层，不在此处配置。

import { Modal, Toast, BaseSettingsEditor, generateShortUUID } from '@itookit/common';
import type {
    IConnectionService, LLMProvider, LLMModel, ModelCategory,
    LLMProviderImplementation, ConnectionMeta, AgentDefinition,
} from '@itookit/common';
import { exportBundleToLLM, fromConnectionDef } from '@itookit/device-llm';
import { runLLMImport } from './llm-import';

/** 模型用途分类选项（顺序即下拉顺序） */
const MODEL_CATEGORIES: ModelCategory[] = ['chat', 'image', 'video', 'audio', 'embedding'];
/** 能力 chip：[能力键, LLMModel 字段, emoji] */
const MODEL_CAP_CHIPS: ReadonlyArray<[string, keyof LLMModel, string]> = [
    ['vision', 'supportsVision', '👁️'],
    ['thinking', 'supportsThinking', '🧠'],
    ['tools', 'supportsTools', '🔧'],
    ['audio', 'supportsAudio', '🎵'],
    ['video', 'supportsVideo', '🎬'],
    ['structuredOutput', 'supportsStructuredOutput', '📋'],
];

export class ProviderSettingsEditor extends BaseSettingsEditor<IConnectionService> {
    private editModels: LLMModel[] = [];
    private _checkedIds = new Set<string>();

    async render() {
        const providers = this.service.getProviders();

        // Sort: has-apiKey first → enabled first → alphabetical
        const keyedIds = new Set<string>();
        for (const p of providers) {
            const full = this.service.getFullProvider?.(p.id);
            if (full?.apiKey?.trim()) keyedIds.add(p.id);
        }
        const sorted = [...providers].sort((a, b) => {
            const aKey = keyedIds.has(a.id);
            const bKey = keyedIds.has(b.id);
            if (aKey && !bKey) return -1;
            if (!aKey && bKey) return 1;
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
                        <h2 class="settings-page__title">Provider 配置</h2>
                        <p class="settings-page__description">
                            管理云提供商的模型目录、API 地址和默认层级映射。
                            连接（API Key）在「LLM 连接」页配置。
                        </p>
                    </div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
                        <input type="file" id="llm-provider-import-file"
                               accept=".llm,.yaml,.yml" multiple style="display:none">
                        <button id="btn-import-provider-llm" class="settings-btn settings-btn--secondary"
                                title="从 .llm 文件导入 Provider 和连接">
                            ↑ 导入 .llm
                        </button>
                        <button id="btn-export-provider-llm" class="settings-btn settings-btn--secondary"
                                ${checkedCount === 0 ? 'disabled' : ''}
                                title="将选中 Provider 及其连接导出为 .llm 文件">
                            ↓ 导出${checkedCount > 0 ? ` (${checkedCount})` : ''}
                        </button>
                        <button id="btn-delete-provider-batch" class="settings-btn settings-btn--danger"
                                ${checkedCount === 0 ? 'disabled' : ''}
                                title="删除选中的自定义 Provider（内置 Provider 不可删除）">
                            🗑️ 删除${checkedCount > 0 ? ` (${checkedCount})` : ''}
                        </button>
                        <button id="btn-add-provider" class="settings-btn settings-btn--primary">
                            <span class="settings-btn__icon">+</span> 添加自定义
                        </button>
                    </div>
                </div>

                <div id="providers-list" class="settings-connection-grid">
                    ${sorted.map(p => this.renderProviderCard(p)).join('')}
                </div>
            </div>
        `;

        this.bindListEvents();
        this.consumeAnchor(sorted);
    }

    // ── Card ───────────────────────────────────────────────────────────────────

    private renderProviderCard(p: LLMProvider): string {
        const fullP    = this.service.getFullProvider?.(p.id);
        const hasKey   = !!(fullP?.apiKey?.trim());
        const enabled  = p.enabled !== false;
        // A provider is "currently built-in" only if it exists in the live catalog.
        const currentBuiltins = this.service.getProviderDefaults?.() ?? {};
        const isCurrentBuiltin = !!currentBuiltins[p.id];
        const badge = isCurrentBuiltin
            ? '<span class="settings-badge settings-badge--info">内置</span>'
            : '<span class="settings-badge settings-badge--warning">自定义</span>';
        const keyBadge = hasKey
            ? ''
            : '<span class="settings-badge settings-badge--warning" style="font-size:0.7rem">需配置 Key</span>';
        const disabledStyle = enabled ? '' : 'opacity:0.55;';

        const isChecked = this._checkedIds.has(p.id);

        return `
            <div class="settings-connection-card" data-id="${p.id}" style="${disabledStyle}">
                <div class="settings-connection-card__header">
                    <div style="display:flex;align-items:center;gap:6px;min-width:0">
                        <input type="checkbox" class="chk-provider-select" data-id="${p.id}"
                               ${isChecked ? 'checked' : ''}
                               title="选中以批量导出"
                               style="flex-shrink:0;cursor:pointer;width:15px;height:15px">
                        <h3 class="settings-connection-card__title"
                            style="margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                            ${p.icon ?? ''} ${p.name}
                        </h3>
                    </div>
                    <div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center">
                        ${badge}${keyBadge}
                        <label class="llm-enable-toggle" title="${enabled ? '点击禁用' : '点击启用'}">
                            <input type="checkbox" class="chk-provider-enabled" data-id="${p.id}"
                                   ${enabled ? 'checked' : ''} style="display:none">
                            <span class="llm-enable-toggle__track ${enabled ? 'llm-enable-toggle__track--on' : ''}">
                                <span class="llm-enable-toggle__thumb"></span>
                            </span>
                        </label>
                    </div>
                </div>

                <div class="settings-connection-card__details">
                    <div class="settings-detail-item">
                        <span class="settings-detail-item__label">实现</span>
                        <span class="settings-detail-item__value">${p.implementation}</span>
                    </div>
                    <div class="settings-detail-item">
                        <span class="settings-detail-item__label">Base URL</span>
                        <span class="settings-detail-item__value" style="font-size:0.75rem;word-break:break-all">
                            ${p.baseURL || '—'}
                        </span>
                    </div>
                    <div class="settings-detail-item">
                        <span class="settings-detail-item__label">模型数量</span>
                        <span class="settings-detail-item__value">${p.models.length} 个</span>
                    </div>
                    <div class="settings-detail-item">
                        <span class="settings-detail-item__label">API Key</span>
                        <span class="settings-detail-item__value">
                            ${hasKey
                                ? '<span style="color:var(--st-color-success,#10b981)">✓ 已配置</span>'
                                : '<span style="color:var(--st-text-disabled)">未配置</span>'
                            }
                        </span>
                    </div>
                </div>

                <div class="settings-page__actions" style="margin-top:auto;width:100%">
                    <button class="settings-btn settings-btn--secondary settings-btn--sm btn-edit-provider" style="flex:1">
                        ✏️ 编辑
                    </button>
                    ${isCurrentBuiltin
                        ? '<button class="settings-btn settings-btn--danger settings-btn--sm btn-delete-provider" style="flex:1">🗑️ 删除</button>'
                        : '<button class="settings-btn settings-btn--danger settings-btn--sm btn-delete-provider" style="flex:1">🗑️ 删除</button>'
                    }
                </div>
            </div>
        `;
    }


    // ── List events ────────────────────────────────────────────────────────────

    /**
     * Consumes the one-shot `settings_anchor` from sessionStorage.
     * If the anchor matches a provider id, highlights the card, scrolls it into view,
     * and opens the edit modal automatically. Clears the entry to avoid repeat triggers.
     */
    private consumeAnchor(providers: LLMProvider[]): void {
        const raw = sessionStorage.getItem('settings_anchor');
        if (!raw) return;
        try {
            const { target, anchor, timestamp } = JSON.parse(raw) as { target: string; anchor: string; timestamp: number };
            // Discard stale entries (> 5s old) or entries not for this page
            if (target !== 'settings' || Date.now() - timestamp > 5000) {
                sessionStorage.removeItem('settings_anchor');
                return;
            }
            sessionStorage.removeItem('settings_anchor');
            const provider = providers.find(p => p.id === anchor);
            if (!provider) return;

            // Highlight card and scroll into view
            const card = this.container.querySelector(`[data-id="${CSS.escape(anchor)}"]`) as HTMLElement | null;
            if (card) {
                card.classList.add('settings-card--anchored');
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                setTimeout(() => card.classList.remove('settings-card--anchored'), 2000);
            }
            // Auto-open the edit modal
            setTimeout(() => this.showEditModal(provider), 120);
        } catch {
            sessionStorage.removeItem('settings_anchor');
        }
    }

    private bindListEvents() {
        this.clearListeners();

        this.bindButton('#btn-add-provider', () => this.showEditModal(null));
        this.bindButton('#btn-import-provider-llm', () => {
            (this.container.querySelector('#llm-provider-import-file') as HTMLInputElement)?.click();
        });
        this.bindButton('#btn-export-provider-llm', () => this.exportSelected());
        this.bindButton('#btn-delete-provider-batch', () => { void this.batchDelete(); });

        const fileInput = this.container.querySelector('#llm-provider-import-file') as HTMLInputElement | null;
        if (fileInput) {
            this.addEventListener(fileInput, 'change', async () => {
                if (fileInput.files?.length) {
                    await this.importLLMFiles(fileInput.files);
                    fileInput.value = '';
                }
            });
        }

        const list = this.container.querySelector('#providers-list');
        if (!list) return;

        // Multi-select checkbox
        this.addEventListener(list, 'change', async (e) => {
            const target = e.target as HTMLInputElement;
            if (target.classList.contains('chk-provider-select')) {
                const id = target.dataset.id!;
                if (target.checked) this._checkedIds.add(id);
                else this._checkedIds.delete(id);
                const count = this._checkedIds.size;
                const exportBtn = this.container.querySelector('#btn-export-provider-llm') as HTMLButtonElement | null;
                if (exportBtn) { exportBtn.disabled = count === 0; exportBtn.textContent = `↓ 导出${count > 0 ? ` (${count})` : ''}`; }
                const deleteBtn = this.container.querySelector('#btn-delete-provider-batch') as HTMLButtonElement | null;
                if (deleteBtn) { deleteBtn.disabled = count === 0; deleteBtn.textContent = `🗑️ 删除${count > 0 ? ` (${count})` : ''}`; }
                return;
            }
            // Enable/disable toggle
            if (target.classList.contains('chk-provider-enabled')) {
                const id = target.dataset.id!;
                const full = this.service.getFullProvider?.(id);
                if (!full) return;
                await this.service.saveProvider({ ...full, enabled: target.checked });
                this.render();
            }
        });

        this.addEventListener(list, 'click', async (e) => {
            const target = e.target as HTMLElement;
            // Don't intercept toggle/checkbox clicks
            if (target.closest('.llm-enable-toggle') || target.classList.contains('chk-provider-select')) return;
            const card   = target.closest('[data-id]') as HTMLElement | null;
            if (!card) return;
            const id = card.dataset.id!;
            const providers = this.service.getProviders();
            const provider  = providers.find(p => p.id === id);
            if (!provider) return;

            if (target.closest('.btn-edit-provider')) {
                this.showEditModal(provider);
            } else if (target.closest('.btn-delete-provider')) {
                void this.confirmDelete(provider);
            } else if (target.closest('.btn-reset-provider')) {
                this.confirmReset(provider);
            }
        });
    }

    // ── Import / Export ────────────────────────────────────────────────────────

    private async importLLMFiles(files: FileList): Promise<void> {
        try {
            const imported = await runLLMImport(files, this.service);
            if (imported) this.render();
        } catch (err) {
            console.error('LLM import failed:', err);
            Toast.error(`导入失败: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    private async exportSelected(): Promise<void> {
        const ids = [...this._checkedIds];
        if (!ids.length) return;

        const allProviders = this.service.getProviders();
        const providers = allProviders.filter(p => ids.includes(p.id));
        const allConns = await this.service.getConnections();
        const connections = allConns
            .filter(c => ids.includes(c.providerId ?? (c as { provider?: string }).provider ?? ''))
            .map(c => fromConnectionDef({ id: c.id, name: c.name, providerId: c.providerId, tiers: c.tiers }));

        const yamlStr = exportBundleToLLM(providers, connections);
        const filename = providers.length === 1 ? `${providers[0].id}.llm` : 'providers-export.llm';
        const blob = new Blob([yamlStr], { type: 'text/yaml' });
        const a = Object.assign(document.createElement('a'), {
            href: URL.createObjectURL(blob), download: filename,
        });
        a.click();
        URL.revokeObjectURL(a.href);
    }

    private async batchDelete(): Promise<void> {
        const ids = [...this._checkedIds];
        if (!ids.length) return;

        const allProviders = this.service.getProviders();
        const deletable = allProviders.filter(p => ids.includes(p.id));

        if (!deletable.length) {
            Toast.error('未找到可删除的 Provider');
            return;
        }

        // ── Cascade analysis ───────────────────────────────────────────────────
        const deletableIds   = new Set(deletable.map(p => p.id));
        const allConns       = await this.service.getConnections();
        const affectedConns  = allConns.filter(c => deletableIds.has(c.providerId ?? ''));
        const affectedConnIds = new Set(affectedConns.map(c => c.id));
        // Connections available as replacement targets (not being deleted)
        const replacementConns = allConns.filter(c => !affectedConnIds.has(c.id));

        type AgentSvc = {
            getAgents(): Promise<AgentDefinition[]>;
            saveAgent(a: AgentDefinition): Promise<void>;
            deleteAgent(id: string): Promise<void>;
        };
        const agentSvc = 'getAgents' in this.service ? this.service as unknown as AgentSvc : null;
        const affectedAgents: AgentDefinition[] = agentSvc
            ? (await agentSvc.getAgents()).filter(a => affectedConnIds.has(a.config.connectionId))
            : [];

        this.showDeleteImpactModal({
            deletable,
            affectedConns,
            affectedAgents, replacementConns,
            agentSvc,
        });
    }

    /**
     * Pick the best default replacement connection for agents:
     * 1. Has API key + same model (tiers.optimal) as the agent's old connection
     * 2. Has API key (any model)
     * 3. First available connection
     */
    private pickBestReplacement(
        affectedConns: ConnectionMeta[],
        replacementConns: ConnectionMeta[],
    ): string {
        // Build a quick lookup: connectionId → model
        const modelMap = new Map(affectedConns.map(c => [c.id, c.model]));
        // Filter to connections with API keys
        const withKey = replacementConns.filter(c => c.hasApiKey);
        // Try same-model match among key-bearing connections
        for (const rc of (withKey.length > 0 ? withKey : replacementConns)) {
            for (const ac of affectedConns) {
                const oldModel = modelMap.get(ac.id);
                if (oldModel && rc.model === oldModel) return rc.id;
            }
        }
        // Fallback: first key-bearing, otherwise first available
        return withKey[0]?.id ?? replacementConns[0]?.id ?? '';
    }

    private showDeleteImpactModal(opts: {
        deletable: LLMProvider[];
        affectedConns: ConnectionMeta[];
        affectedAgents: AgentDefinition[];
        replacementConns: ConnectionMeta[];
        agentSvc: {
            saveAgent(a: AgentDefinition): Promise<void>;
            deleteAgent(id: string): Promise<void>;
        } | null;
    }): void {
        const { deletable, affectedConns, affectedAgents, replacementConns, agentSvc } = opts;

        const providerListHtml = deletable.map(p =>
            `<li>${p.icon ?? ''} <strong>${p.name}</strong> <code style="font-size:.75rem;opacity:.7">${p.id}</code></li>`,
        ).join('');

        const connSectionHtml = affectedConns.length > 0 ? `
            <div class="llm-delete-impact-section llm-delete-impact-section--warn">
                <div class="llm-delete-impact-section__title">
                    ⚠️ 同时将删除以下关联连接（${affectedConns.length} 个）
                </div>
                <ul class="llm-delete-impact-list">
                    ${affectedConns.map(c => `<li><strong>${c.name}</strong> <code style="font-size:.75rem;opacity:.7">${c.id}</code></li>`).join('')}
                </ul>
            </div>
        ` : '';

        const bestReplacement = this.pickBestReplacement(affectedConns, replacementConns);
        const replacementOptions = replacementConns.map(c =>
            `<option value="${c.id}" ${c.id === bestReplacement ? 'selected' : ''}>${c.name}${c.hasApiKey ? ' ✓' : ''}</option>`,
        ).join('');

        const agentSectionHtml = affectedAgents.length > 0 ? `
            <div class="llm-delete-impact-section llm-delete-impact-section--info">
                <div class="llm-delete-impact-section__title">
                    以下 Agent 引用了被删除的连接（${affectedAgents.length} 个）
                </div>
                <ul class="llm-delete-impact-list">
                    ${affectedAgents.map(a => {
                        const connName = opts.affectedConns.find(c => c.id === a.config.connectionId)?.name ?? a.config.connectionId;
                        return `<li>${a.icon ?? '🤖'} <strong>${a.name}</strong> <span style="opacity:.6;font-size:.8rem">→ ${connName}</span></li>`;
                    }).join('')}
                </ul>
                <fieldset style="border:none;padding:8px 0 0;margin:0">
                    <legend style="font-size:.8rem;font-weight:600;margin-bottom:8px;color:var(--st-text-primary)">Agent 处理方式</legend>
                    <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer;font-size:.875rem">
                        <input type="radio" name="agent-action" value="delete">
                        删除以上 Agent
                    </label>
                    <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;cursor:pointer;font-size:.875rem">
                        <input type="radio" name="agent-action" value="replace" ${replacementConns.length > 0 ? 'checked' : 'disabled'}>
                        替换连接为
                        <select id="agent-replacement-conn" class="settings-form__select"
                                style="padding:2px 6px;font-size:.8rem;min-width:140px"
                                ${replacementConns.length === 0 ? 'disabled' : ''}>
                            ${replacementConns.length > 0 ? replacementOptions : '<option>（无可用连接）</option>'}
                        </select>
                    </label>
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:.875rem">
                        <input type="radio" name="agent-action" value="keep" ${replacementConns.length === 0 ? 'checked' : ''}>
                        保留 Agent（连接引用失效，可手动修复）
                    </label>
                </fieldset>
            </div>
        ` : '';

        const body = `
            <div style="font-size:.875rem">
                <div class="llm-delete-impact-section">
                    <div class="llm-delete-impact-section__title">将删除以下 Provider（${deletable.length} 个）</div>
                    <ul class="llm-delete-impact-list">${providerListHtml}</ul>
                </div>
                ${connSectionHtml}
                ${agentSectionHtml}
            </div>
            <style>
                .llm-delete-impact-section { margin-bottom:14px; padding:10px 12px; border-radius:6px; background:var(--st-bg-secondary,#f8f8f8); }
                .llm-delete-impact-section--warn { background:var(--st-warning-bg,#fff8e1); }
                .llm-delete-impact-section--info { background:var(--st-info-bg,#e8f4fd); }
                .llm-delete-impact-section__title { font-weight:600; margin-bottom:6px; }
                .llm-delete-impact-list { margin:0; padding-left:18px; }
                .llm-delete-impact-list li { margin-bottom:3px; }
            </style>
        `;

        new Modal('确认删除 Provider', body, {
            confirmText: '确认删除',
            type: 'danger',
            width: '520px',
            onConfirm: async () => {
                // 1. Delete providers
                for (const p of deletable) {
                    await this.service.deleteProvider(p.id);
                }
                // 2. Delete affected connections
                for (const c of affectedConns) {
                    await this.service.deleteConnection(c.id);
                }
                // 3. Handle affected agents
                if (agentSvc && affectedAgents.length > 0) {
                    const radio = document.querySelector(
                        'input[name="agent-action"]:checked',
                    ) as HTMLInputElement | null;
                    const action = radio?.value ?? 'keep';

                    if (action === 'delete') {
                        for (const a of affectedAgents) {
                            await agentSvc.deleteAgent(a.id);
                        }
                    } else if (action === 'replace') {
                        const sel = document.getElementById('agent-replacement-conn') as HTMLSelectElement | null;
                        const newConnId = sel?.value;
                        if (newConnId) {
                            for (const a of affectedAgents) {
                                await agentSvc.saveAgent({ ...a, config: { ...a.config, connectionId: newConnId } });
                            }
                        }
                    }
                    // 'keep' → do nothing
                }

                this._checkedIds.clear();
                const parts = [`${deletable.length} 个 Provider`];
                if (affectedConns.length) parts.push(`${affectedConns.length} 个连接`);
                Toast.success(`已删除：${parts.join('、')}`);
                this.render();
            },
        }).show();
    }

    // ── Edit modal ─────────────────────────────────────────────────────────────

    private showEditModal(provider: LLMProvider | null) {
        const isNew   = !provider;
        const isBuiltin = !!provider?.isBuiltin;

        // Load full provider (with apiKey) when editing an existing one
        const fullProvider = provider ? (this.service.getFullProvider(provider.id) ?? provider) : null;

        this.editModels = fullProvider ? JSON.parse(JSON.stringify(fullProvider.models)) : [];
        const existingApiKey = fullProvider?.apiKey ?? '';

        const implementations: LLMProviderImplementation[] = [
            'openai-compatible', 'anthropic', 'gemini', 'custom',
        ];

        const modalContent = `
            <form id="provider-form" class="settings-form settings-form--wide">
                <div class="settings-row">
                    <!-- Left: basic config -->
                    <div class="settings-col">
                        <h4 class="settings-section-title">基础配置</h4>

                        <div class="settings-form__group">
                            <label class="settings-form__label">Provider 名称 *</label>
                            <input type="text" class="settings-form__input" name="name"
                                   value="${provider?.name ?? ''}" required placeholder="如 My Proxy">
                        </div>

                        <div class="settings-form__group">
                            <label class="settings-form__label">图标</label>
                            <input type="text" class="settings-form__input" name="icon"
                                   value="${provider?.icon ?? ''}" placeholder="🛠️" style="max-width:80px">
                        </div>

                        <div class="settings-form__group">
                            <label class="settings-form__label">实现类型 *</label>
                            <select class="settings-form__select" name="implementation">
                                ${implementations.map(impl => `
                                    <option value="${impl}" ${provider?.implementation === impl ? 'selected' : ''}>
                                        ${impl}
                                    </option>
                                `).join('')}
                            </select>
                        </div>

                        <div class="settings-form__group">
                            <label class="settings-form__label">API Key</label>
                            <input type="password" class="settings-form__input" name="apiKey"
                                   value="${existingApiKey}"
                                   placeholder="sk-... （留空则不修改现有 Key）">
                            <small class="settings-form__help">
                                存储于 Provider 层，所有绑定此 Provider 的连接共享此 Key。
                            </small>
                        </div>

                        <div class="settings-form__group">
                            <button type="button" id="btn-test-provider"
                                    class="settings-btn settings-btn--secondary settings-btn--sm" style="width:100%">
                                🔍 测试 API Key
                            </button>
                            <div id="provider-test-result" style="display:none; margin-top:8px; padding:8px 10px; border-radius:4px; font-size:12px;"></div>
                        </div>

                        <div class="settings-form__group">
                            <label class="settings-form__label">默认温度 (0-2)</label>
                            <input type="number" class="settings-form__input" name="defaultTemperature"
                                   value="${fullProvider?.defaultTemperature ?? provider?.defaultTemperature ?? ''}"
                                   min="0" max="2" step="0.1" placeholder="未设置（由 Connection 决定）"
                                   style="max-width:120px">
                            <small class="settings-form__help">
                                所有绑定此 Provider 的连接继承此温度。Connection 可覆盖。
                            </small>
                        </div>

                        <div class="settings-form__group">
                            <label class="settings-form__label">Base URL *</label>
                            <input type="text" class="settings-form__input" name="baseURL"
                                   value="${fullProvider?.baseURL ?? provider?.baseURL ?? ''}" required placeholder="https://api.example.com/v1">
                        </div>

                    </div>

                    <!-- Right: model list -->
                    <div class="settings-col settings-col--border">
                        <h4 class="settings-section-title" style="display:flex;justify-content:space-between;align-items:center">
                            模型列表
                            <button type="button" id="btn-add-model" class="settings-btn settings-btn--xs settings-btn--primary">+ 新增</button>
                        </h4>
                        <div class="settings-model-list-container" id="model-list-container">
                            ${this.renderModelListHTML()}
                        </div>
                        <small class="settings-form__help">Model ID 须与 API 实际返回的 ID 一致。</small>
                    </div>
                </div>
            </form>
        `;

        new Modal(isNew ? '添加 Provider' : `编辑 Provider — ${provider!.name}`, modalContent, {
            width: '820px',
            confirmText: '保存',
            onConfirm: async () => {
                const form = document.getElementById('provider-form') as HTMLFormElement;
                if (!form.checkValidity()) { form.reportValidity(); return false; }

                this.syncInputsToModelData();

                const formData = new FormData(form);
                const data = Object.fromEntries(formData) as Record<string, string>;

                const newApiKey = (data.apiKey as string || '').trim();
                const updated: LLMProvider = {
                    id: provider?.id ?? `prov-${generateShortUUID()}`,
                    name: data.name,
                    icon: data.icon || undefined,
                    implementation: data.implementation as LLMProviderImplementation,
                    baseURL: data.baseURL,
                    // Keep existing apiKey if field was left empty
                    apiKey: newApiKey || existingApiKey || undefined,
                    models: [...this.editModels],
                    isBuiltin: isBuiltin,
                    defaultTemperature: (() => {
                        const v = parseFloat(data.defaultTemperature);
                        return !isNaN(v) ? v : undefined;
                    })(),
                    dailyCosts: provider?.dailyCosts,
                };

                await this.service.saveProvider(updated);
                Toast.success('Provider 已保存');
                this.render();
            },
        }).show();

        setTimeout(() => this.bindModalEvents(), 100);
    }

    private renderModelListHTML(): string {
        if (this.editModels.length === 0) {
            return '<div class="settings-empty-small">暂无模型，请添加</div>';
        }
        return this.editModels.map((m, i) => `
            <div class="settings-model-item">
                <div class="settings-model-item__drag">::</div>
                <div class="settings-model-item__content" style="flex-direction:column;gap:4px;align-items:stretch">
                    <div style="display:flex;gap:4px">
                        <input type="text" class="settings-input-sm model-id-input" data-idx="${i}"
                               value="${m.id}" placeholder="Model ID" title="Model ID（API 用）">
                        <input type="text" class="settings-input-sm model-name-input" data-idx="${i}"
                               value="${m.name}" placeholder="显示名称">
                    </div>
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                        <select class="settings-input-sm model-category-select" data-idx="${i}" title="模型用途" style="max-width:110px">
                            ${MODEL_CATEGORIES.map(cat => `
                                <option value="${cat}" ${(m.category ?? 'chat') === cat ? 'selected' : ''}>${cat}</option>
                            `).join('')}
                        </select>
                        ${MODEL_CAP_CHIPS.map(([cap, field, emoji]) => `
                            <label class="model-cap-chip" title="${cap}"
                                   style="display:inline-flex;align-items:center;cursor:pointer;font-size:13px;padding:2px 4px;border-radius:4px;opacity:${m[field] === true ? '1' : '0.35'}">
                                <input type="checkbox" class="model-cap-chk" data-cap="${cap}" data-idx="${i}"
                                       ${m[field] === true ? 'checked' : ''} style="display:none">
                                ${emoji}
                            </label>
                        `).join('')}
                    </div>
                </div>
                <div class="settings-model-item__actions">
                    <button type="button" class="btn-icon btn-up"   data-idx="${i}" ${i === 0 ? 'disabled' : ''}>⬆️</button>
                    <button type="button" class="btn-icon btn-down" data-idx="${i}" ${i === this.editModels.length - 1 ? 'disabled' : ''}>⬇️</button>
                    <button type="button" class="btn-icon btn-del text-danger" data-idx="${i}">✖️</button>
                </div>
            </div>
        `).join('');
    }

    // ── Modal events ───────────────────────────────────────────────────────────

    private bindModalEvents() {
        const listContainer = document.getElementById('model-list-container') as HTMLElement | null;
        const addModelBtn   = document.getElementById('btn-add-model') as HTMLButtonElement | null;

        const renderList = () => {
            if (!listContainer) return;
            listContainer.innerHTML = this.renderModelListHTML();
        };

        // Test API Key button
        const testBtn    = document.getElementById('btn-test-provider') as HTMLButtonElement | null;
        const testResult = document.getElementById('provider-test-result') as HTMLElement | null;
        if (testBtn && testResult) {
            testBtn.addEventListener('click', async () => {
                if (testBtn.disabled) return;
                const form = document.getElementById('provider-form') as HTMLFormElement;
                const apiKey  = ((form.querySelector('[name="apiKey"]')  as HTMLInputElement)?.value || '').trim();
                const provId  = ((form.querySelector('[name="implementation"]') as HTMLSelectElement)?.value) || '';
                const baseURL = ((form.querySelector('[name="baseURL"]') as HTMLInputElement)?.value || '').trim();
                const models  = this.editModels;
                const model   = models[0]?.id;

                if (!apiKey) {
                    testResult.style.cssText = 'display:block;padding:8px;border-radius:4px;background:var(--st-warning-bg,#fff3cd);color:var(--st-warning,#856404);font-size:12px';
                    testResult.textContent = '⚠️ 请先填写 API Key';
                    return;
                }
                testBtn.disabled = true; testBtn.textContent = '⏳ 测试中...';
                testResult.style.display = 'none';
                try {
                    const r = await this.service.testConnection({ provider: provId, apiKey, baseURL, model });
                    testResult.style.cssText = `display:block;padding:8px;border-radius:4px;font-size:12px;background:${r.success ? 'var(--st-success-bg,#d4edda)' : 'var(--st-danger-bg,#f8d7da)'};color:${r.success ? 'var(--st-success,#155724)' : 'var(--st-danger,#721c24)'}`;
                    testResult.textContent = `${r.success ? '✅' : '❌'} ${r.message || (r.success ? '连接测试成功' : '连接测试失败')}`;
                } catch (e: unknown) {
                    testResult.style.cssText = 'display:block;padding:8px;border-radius:4px;font-size:12px;background:var(--st-danger-bg,#f8d7da);color:var(--st-danger,#721c24)';
                    testResult.textContent = `❌ 测试出错: ${e instanceof Error ? e.message : String(e)}`;
                } finally {
                    testBtn.disabled = false; testBtn.textContent = '🔍 测试 API Key';
                }
            });
        }

        // Add model
        addModelBtn?.addEventListener('click', () => {
            this.syncInputsToModelData();
            this.editModels.push({ id: 'new-model-id', name: 'New Model', category: 'chat' });
            renderList();
            listContainer?.scrollTo({ top: listContainer.scrollHeight, behavior: 'smooth' });
        });

        // Model list actions (up/down/delete)
        listContainer?.addEventListener('click', (e) => {
            const btn = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
            if (!btn) return;
            const idx = parseInt(btn.dataset.idx!);
            if (isNaN(idx)) return;
            this.syncInputsToModelData();
            if (btn.classList.contains('btn-del')) {
                this.editModels.splice(idx, 1);
            } else if (btn.classList.contains('btn-up') && idx > 0) {
                [this.editModels[idx], this.editModels[idx - 1]] = [this.editModels[idx - 1], this.editModels[idx]];
            } else if (btn.classList.contains('btn-down') && idx < this.editModels.length - 1) {
                [this.editModels[idx], this.editModels[idx + 1]] = [this.editModels[idx + 1], this.editModels[idx]];
            }
            renderList();
        });

        // Capability chip toggle — visual feedback (dim when unchecked)
        listContainer?.addEventListener('change', (e) => {
            const chk = e.target as HTMLElement;
            if (!chk.classList.contains('model-cap-chk')) return;
            const label = chk.closest('.model-cap-chip') as HTMLElement | null;
            if (label) label.style.opacity = (chk as HTMLInputElement).checked ? '1' : '0.35';
        });
    }

    // ── Sync helpers ───────────────────────────────────────────────────────────

    private syncInputsToModelData() {
        const container = document.getElementById('model-list-container');
        if (!container) return;
        const capMap: Record<string, keyof LLMModel> = {
            vision: 'supportsVision',
            thinking: 'supportsThinking',
            tools: 'supportsTools',
            audio: 'supportsAudio',
            video: 'supportsVideo',
            structuredOutput: 'supportsStructuredOutput',
        };
        container.querySelectorAll('.settings-model-item').forEach((row, i) => {
            if (i >= this.editModels.length) return;
            const idEl   = row.querySelector('.model-id-input') as HTMLInputElement | null;
            const nameEl = row.querySelector('.model-name-input') as HTMLInputElement | null;
            if (idEl)   this.editModels[i].id   = idEl.value.trim();
            if (nameEl) this.editModels[i].name = nameEl.value.trim();

            const catEl = row.querySelector('.model-category-select') as HTMLSelectElement | null;
            if (catEl) this.editModels[i].category = (catEl.value as ModelCategory) || undefined;

            const model = this.editModels[i] as unknown as Record<string, unknown>;
            row.querySelectorAll('.model-cap-chk').forEach((chk) => {
                const el = chk as HTMLInputElement;
                const field = capMap[el.dataset.cap ?? ''];
                if (field) model[field] = el.checked || undefined;
            });
        });
    }

    // ── Delete / Reset ─────────────────────────────────────────────────────────

    private async confirmDelete(provider: LLMProvider): Promise<void> {
        const allConns       = await this.service.getConnections();
        const affectedConns  = allConns.filter(c => (c.providerId ?? '') === provider.id);
        const affectedConnIds = new Set(affectedConns.map(c => c.id));
        const replacementConns = allConns.filter(c => !affectedConnIds.has(c.id));

        type AgentSvc = {
            getAgents(): Promise<AgentDefinition[]>;
            saveAgent(a: AgentDefinition): Promise<void>;
            deleteAgent(id: string): Promise<void>;
        };
        const agentSvc = 'getAgents' in this.service ? this.service as unknown as AgentSvc : null;
        const affectedAgents: AgentDefinition[] = agentSvc
            ? (await agentSvc.getAgents()).filter(a => affectedConnIds.has(a.config.connectionId))
            : [];

        this.showDeleteImpactModal({
            deletable: [provider],
            affectedConns,
            affectedAgents,
            replacementConns,
            agentSvc,
        });
    }

    private confirmReset(provider: LLMProvider) {
        Modal.confirm(
            '确认重置',
            `将「${provider.name}」恢复为内置默认配置（BaseURL / 模型列表），确定继续？`,
            async () => {
                // Re-save from built-in constant (getProviderDefaults returns raw constant values)
                const defaults = this.service.getProviderDefaults();
                const def = defaults[provider.id];
                if (!def) { Toast.error('找不到内置默认配置'); return; }
                await this.service.saveProvider({ ...def, id: provider.id, isBuiltin: true });
                Toast.success('已恢复默认配置');
                this.render();
            },
        );
    }

    // ── Utility ────────────────────────────────────────────────────────────────

    private bindButton(selector: string, handler: () => void) {
        const btn = this.container.querySelector(selector);
        if (btn) this.addEventListener(btn, 'click', handler);
    }
}
