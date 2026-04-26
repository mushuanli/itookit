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
    IConnectionService, LLMProvider, LLMModel,
    LLMProviderImplementation,
} from '@itookit/common';

export class ProviderSettingsEditor extends BaseSettingsEditor<IConnectionService> {
    private editModels: LLMModel[] = [];

    async render() {
        const providers = this.service.getProviders();

        // enabled first, then disabled; within each group alphabetically
        const sorted = [...providers].sort((a, b) => {
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
                        <h2 class="settings-page__title">Provider 配置</h2>
                        <p class="settings-page__description">
                            管理云提供商的模型目录、API 地址和默认层级映射。
                            连接（API Key）在「LLM 连接」页配置。
                        </p>
                    </div>
                    <button id="btn-add-provider" class="settings-btn settings-btn--primary">
                        <span class="settings-btn__icon">+</span> 添加自定义
                    </button>
                </div>

                <div id="providers-list" class="settings-connection-grid">
                    ${sorted.map(p => this.renderProviderCard(p)).join('')}
                </div>
            </div>
        `;

        this.bindListEvents();
    }

    // ── Card ───────────────────────────────────────────────────────────────────

    private renderProviderCard(p: LLMProvider): string {
        const fullP    = this.service.getFullProvider?.(p.id);
        const hasKey   = !!(fullP?.apiKey?.trim());
        const enabled  = p.enabled !== false;
        const badge = p.isBuiltin
            ? '<span class="settings-badge settings-badge--info">内置</span>'
            : '<span class="settings-badge settings-badge--warning">自定义</span>';
        const keyBadge = hasKey
            ? ''
            : '<span class="settings-badge settings-badge--warning" style="font-size:0.7rem">需配置 Key</span>';
        const disabledStyle = enabled ? '' : 'opacity:0.55;';

        return `
            <div class="settings-connection-card" data-id="${p.id}" style="${disabledStyle}">
                <div class="settings-connection-card__header">
                    <h3 class="settings-connection-card__title">${p.icon ?? ''} ${p.name}</h3>
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
                    ${p.isBuiltin
                        ? '<button class="settings-btn settings-btn--sm btn-reset-provider" style="flex:1">↩️ 重置</button>'
                        : '<button class="settings-btn settings-btn--danger settings-btn--sm btn-delete-provider" style="flex:1">🗑️ 删除</button>'
                    }
                </div>
            </div>
        `;
    }


    // ── List events ────────────────────────────────────────────────────────────

    private bindListEvents() {
        this.clearListeners();

        this.bindButton('#btn-add-provider', () => this.showEditModal(null));

        const list = this.container.querySelector('#providers-list');
        if (!list) return;

        // Enable/disable toggle (checkbox change)
        this.addEventListener(list, 'change', async (e) => {
            const target = e.target as HTMLInputElement;
            if (!target.classList.contains('chk-provider-enabled')) return;
            const id = target.dataset.id!;
            const full = this.service.getFullProvider?.(id);
            if (!full) return;
            await this.service.saveProvider({ ...full, enabled: target.checked });
            this.render();
        });

        this.addEventListener(list, 'click', async (e) => {
            const target = e.target as HTMLElement;
            // Don't intercept toggle clicks
            if (target.closest('.llm-enable-toggle')) return;
            const card   = target.closest('[data-id]') as HTMLElement | null;
            if (!card) return;
            const id = card.dataset.id!;
            const providers = this.service.getProviders();
            const provider  = providers.find(p => p.id === id);
            if (!provider) return;

            if (target.closest('.btn-edit-provider')) {
                this.showEditModal(provider);
            } else if (target.closest('.btn-delete-provider')) {
                this.confirmDelete(provider);
            } else if (target.closest('.btn-reset-provider')) {
                this.confirmReset(provider);
            }
        });
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
                <div class="settings-model-item__content">
                    <input type="text" class="settings-input-sm model-id-input" data-idx="${i}"
                           value="${m.id}" placeholder="Model ID" title="Model ID（API 用）">
                    <input type="text" class="settings-input-sm model-name-input" data-idx="${i}"
                           value="${m.name}" placeholder="显示名称">
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
            this.editModels.push({ id: 'new-model-id', name: 'New Model' });
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
    }

    // ── Sync helpers ───────────────────────────────────────────────────────────

    private syncInputsToModelData() {
        const container = document.getElementById('model-list-container');
        if (!container) return;
        container.querySelectorAll('.settings-model-item').forEach((row, i) => {
            if (i >= this.editModels.length) return;
            const idEl   = row.querySelector('.model-id-input') as HTMLInputElement | null;
            const nameEl = row.querySelector('.model-name-input') as HTMLInputElement | null;
            if (idEl)   this.editModels[i].id   = idEl.value.trim();
            if (nameEl) this.editModels[i].name = nameEl.value.trim();
        });
    }

    // ── Delete / Reset ─────────────────────────────────────────────────────────

    private confirmDelete(provider: LLMProvider) {
        Modal.confirm(
            '确认删除',
            `确定要删除 Provider「${provider.name}」吗？\n使用此 Provider 的连接将失去模型信息。`,
            async () => {
                await this.service.deleteProvider(provider.id);
                Toast.success('Provider 已删除');
                this.render();
            },
        );
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
