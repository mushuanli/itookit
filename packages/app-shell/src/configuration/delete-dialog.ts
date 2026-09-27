import type { DeleteResult } from '@itookit/vfs-ui';
import { t, escapeHTML } from '@itookit/common';
import { Modal, Toast, type EditorTarget } from '@itookit/ui-common';
import { ModelConfigurationCommands, type ProviderDeletionImpact } from '@itookit/app-core';

/** Confirmation UI consumes domain plans; it never creates an editor to delete. */
export class ConfigurationDeletionDialog {
    constructor(private readonly commands: ModelConfigurationCommands, private readonly changed: () => Promise<void> = async () => {},
        private readonly additionalImpact: (targets: readonly EditorTarget[]) => Promise<string> = async () => '') {}
    async request(targets: readonly EditorTarget[]): Promise<void> {
        await this.requestResult(targets);
    }
    async requestResult(targets: readonly EditorTarget[], signal?: AbortSignal): Promise<DeleteResult> {
        if (signal?.aborted) return 'cancelled';
        if (!targets.length) return 'completed';
        const kind = targets[0].kind === 'entity' ? targets[0].entityType : undefined;
        if (!kind || !['provider', 'connection', 'mcp', 'system-prompt'].includes(kind) || targets.some(target => target.kind !== 'entity' || target.entityType !== kind))
            throw new Error('Unsupported configuration deletion');
        const ids = targets.map(target => (target as Extract<EditorTarget, { kind: 'entity' }>).id);
        const warning = await this.additionalImpact(targets);
        if (signal?.aborted) return 'cancelled';
        if (kind === 'provider') return this.showDeleteImpactModal(await this.commands.inspectProviderDeletion(ids), warning, signal);
        return new Promise<DeleteResult>(resolve => new Modal(t('dialog.delete.title'), t('configuration.deleteConfirm', { count: ids.length }) + (warning ? ' ' + escapeHTML(warning) : '') + (kind === 'connection' ? ' ' + t('connection.deleteImpact') : kind === 'system-prompt' ? ' ' + t('prompt.deleteImpact') : ''), {
            onCancel: () => resolve('cancelled'),
            onConfirm: async () => {
                if (signal?.aborted) { resolve('cancelled'); return; }
                await this.commands.deleteResources({ kind: kind === 'system-prompt' ? 'prompts' : kind === 'connection' ? 'connections' : 'mcp', ids });
                await this.changed(); resolve('completed');
            },
        }).show());
    }
    private showDeleteImpactModal(impact: ProviderDeletionImpact, warning: string, signal?: AbortSignal): Promise<DeleteResult> {
        if (signal?.aborted) { this.commands.discardPlan(impact.revision); return Promise.resolve('cancelled'); }
        const { providers: deletable, connections: affectedConns } = impact;
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

        const body = `
            <div style="font-size:.875rem">
                <div class="llm-delete-impact-section">
                    <div class="llm-delete-impact-section__title">将删除以下 Provider（${deletable.length} 个）</div>
                    <ul class="llm-delete-impact-list">${providerListHtml}</ul>
                </div>
                ${connSectionHtml}
                ${warning ? `<p>${escapeHTML(warning)}</p>` : ''}
                <p>${escapeHTML(t('connection.deleteImpact'))}</p>
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

        return new Promise<DeleteResult>(resolve => new Modal('确认删除 Provider', body, {
            confirmText: '确认删除', type: 'danger', width: '520px',
            onCancel: () => { this.commands.discardPlan(impact.revision); resolve('cancelled'); },
            onConfirm: async () => {
                if (signal?.aborted) { this.commands.discardPlan(impact.revision); resolve('cancelled'); return; }
                await this.commands.deleteProviders({ revision: impact.revision });
                await this.changed(); resolve('completed');
                const parts = [`${deletable.length} 个 Provider`];
                if (affectedConns.length) parts.push(`${affectedConns.length} 个连接`);
                Toast.success(`已删除：${parts.join('、')}`);
            },
        }).show());
    }

}
