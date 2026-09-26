import { t, escapeHTML, type ConnectionMeta } from '@itookit/common';
import { Modal, Toast, type EditorTarget } from '@itookit/ui-common';
import { ModelConfigurationCommands, type ProviderDeletionImpact } from '@itookit/app-core';

/** Confirmation UI consumes domain plans; it never creates an editor to delete. */
export class ConfigurationDeletionDialog {
    constructor(private readonly commands: ModelConfigurationCommands, private readonly changed: () => Promise<void> = async () => {}) {}
    async request(targets: readonly EditorTarget[]): Promise<void> {
        if (!targets.length) return;
        const kind = targets[0].kind === 'entity' ? targets[0].entityType : undefined;
        if (!kind || !['provider', 'connection', 'mcp'].includes(kind) || targets.some(target => target.kind !== 'entity' || target.entityType !== kind))
            throw new Error('Unsupported configuration deletion');
        const ids = targets.map(target => (target as Extract<EditorTarget, { kind: 'entity' }>).id);
        if (kind === 'provider') return this.showDeleteImpactModal(await this.commands.inspectProviderDeletion(ids));
        return new Promise(resolve => new Modal(t('dialog.delete.title'), t('configuration.deleteConfirm', { count: ids.length }), {
            onCancel: resolve,
            onConfirm: async () => {
                await this.commands.deleteResources({ kind: kind === 'connection' ? 'connections' : 'mcp', ids });
                await this.changed(); resolve();
            },
        }).show());
    }
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

    private showDeleteImpactModal(impact: ProviderDeletionImpact): Promise<void> {
        const { providers: deletable, connections: affectedConns, agents: affectedAgents, replacements: replacementConns } = impact;
        const providerListHtml = deletable.map(p =>
            `<li>${escapeHTML(p.icon ?? '')} <strong>${escapeHTML(p.name)}</strong> <code style="font-size:.75rem;opacity:.7">${escapeHTML(p.id)}</code></li>`,
        ).join('');

        const connSectionHtml = affectedConns.length > 0 ? `
            <div class="llm-delete-impact-section llm-delete-impact-section--warn">
                <div class="llm-delete-impact-section__title">
                    ⚠️ 同时将删除以下关联连接（${affectedConns.length} 个）
                </div>
                <ul class="llm-delete-impact-list">
                    ${affectedConns.map(c => `<li><strong>${escapeHTML(c.name)}</strong> <code style="font-size:.75rem;opacity:.7">${escapeHTML(c.id)}</code></li>`).join('')}
                </ul>
            </div>
        ` : '';

        const bestReplacement = this.pickBestReplacement(affectedConns, replacementConns);
        const replacementOptions = replacementConns.map(c =>
            `<option value="${escapeHTML(c.id)}" ${c.id === bestReplacement ? 'selected' : ''}>${escapeHTML(c.name)}${c.hasApiKey ? ' ✓' : ''}</option>`,
        ).join('');

        const agentSectionHtml = affectedAgents.length > 0 ? `
            <div class="llm-delete-impact-section llm-delete-impact-section--info">
                <div class="llm-delete-impact-section__title">
                    以下 Agent 引用了被删除的连接（${affectedAgents.length} 个）
                </div>
                <ul class="llm-delete-impact-list">
                    ${affectedAgents.map(a => {
                        const connName = affectedConns.find(c => c.id === a.config.connectionId)?.name ?? a.config.connectionId;
                        return `<li>${escapeHTML(a.icon ?? '🤖')} <strong>${escapeHTML(a.name)}</strong> <span style="opacity:.6;font-size:.8rem">→ ${escapeHTML(connName)}</span></li>`;
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

        return new Promise(resolve => new Modal('确认删除 Provider', body, {
            confirmText: '确认删除', type: 'danger', width: '520px',
            onCancel: () => { this.commands.discardPlan(impact.revision); resolve(); },
            onConfirm: async element => {
                const mode = (element.querySelector('input[name="agent-action"]:checked') as HTMLInputElement | null)?.value ?? 'keep';
                const connectionId = (element.querySelector('#agent-replacement-conn') as HTMLSelectElement | null)?.value ?? '';
                await this.commands.deleteProviders({ revision: impact.revision,
                    agents: mode === 'replace' ? { mode, connectionId } : { mode: mode === 'delete' ? 'delete' : 'keep' } });
                await this.changed(); resolve();
                const parts = [`${deletable.length} 个 Provider`];
                if (affectedConns.length) parts.push(`${affectedConns.length} 个连接`);
                Toast.success(`已删除：${parts.join('、')}`);
            },
        }).show());
    }

}
