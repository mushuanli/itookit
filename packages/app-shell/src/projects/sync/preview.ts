import { t } from '@itookit/common';
import type { ProjectSyncService } from '@itookit/app-core';
import type { StoredFilePlan } from '@itookit/vfs-sync';
import { SyncDialog, paragraph } from './dialog';

export function syncPreview(value: unknown): StoredFilePlan {
    const preview = value as StoredFilePlan;
    if (!preview?.id || !Array.isArray(preview.plan?.actions) || !Array.isArray(preview.plan?.conflicts)) throw new Error('INVALID_SYNC_PREVIEW');
    return preview;
}
export function showSyncPreview(service: ProjectSyncService, projectId: string, initial: StoredFilePlan,
    signal: AbortSignal, changed: (remaining: number) => Promise<void>, direction: 'both' | 'upload' | 'download' = 'both'): void {
    const dialog = new SyncDialog(t('project.sync.preview'), signal);
    let current = initial;
    const choices = new Map<string, HTMLSelectElement>();
    const render = () => { choices.clear(); renderPlan(dialog.body, current, choices, direction); };
    dialog.button(t('project.sync.refreshPreview'), async () => {
        current = syncPreview(await service.preview(projectId)); render(); dialog.message(t('project.sync.previewHint'));
    });
    dialog.button(t('project.sync.merge'), async () => {
        current = syncPreview(await service.mergeText(projectId, current.id, current.plan.conflicts.filter(c => c.baseline?.kind === 'file' && c.local?.kind === 'file' && c.remote?.kind === 'file').map(c => c.path)));
        render(); dialog.message(t('project.sync.reviewMerge'));
    });
    dialog.button(t('project.sync.execute'), async () => {
        const decisions = Object.fromEntries([...choices].filter(([, select]) => select.value).map(([path, select]) => [path, select.value])) as Record<string, 'local' | 'remote'>;
        if (Object.keys(decisions).length) {
            current = syncPreview(await service.resolve(projectId, current.id, decisions)); render();
            dialog.message(t('project.sync.reviewDecisions')); return;
        }
        const result = await service.execute(projectId, current.id) as { warnings?: string[] };
        await changed(current.plan.conflicts.length);
        for (const warning of result.warnings ?? []) paragraph(dialog.body, warning);
        dialog.message(t(current.plan.conflicts.length ? 'project.sync.partial' : 'project.sync.completed', { count: current.plan.conflicts.length }));
        for (const button of dialog.actions.querySelectorAll('button')) button.remove();
        dialog.button(t('project.sync.close'), async () => dialog.close());
    });
    render(); dialog.open();
}
function renderPlan(body: HTMLElement, stored: StoredFilePlan, choices: Map<string, HTMLSelectElement>, direction: 'both' | 'upload' | 'download'): void {
    body.replaceChildren();
    paragraph(body, t('project.sync.previewHint'));
    const list = document.createElement('ul');
    for (const action of stored.plan.actions) {
        const row = document.createElement('li');
        row.textContent = `${t(`project.sync.${action.side}`)} · ${action.path}${!action.output ? ' · ' + t('project.sync.delete') : ''}`;
        list.append(row);
    }
    body.append(list);
    for (const conflict of stored.plan.conflicts) {
        const label = document.createElement('label'); label.textContent = `${conflict.path} · ${conflict.code} `;
        const select = document.createElement('select'); select.setAttribute('aria-label', conflict.path);
        for (const value of ['', 'local', 'remote'] as const) {
            const option = document.createElement('option'); option.value = value;
            option.textContent = t(`project.sync.${value || 'unresolved'}`);
            option.disabled = (value === 'local' && direction === 'download') || (value === 'remote' && direction === 'upload'); select.append(option);
        }
        select.dataset.unavailable = String(conflict.code !== 'CONTENT_CONFLICT' || [conflict.baseline, conflict.local, conflict.remote].some(entry => entry?.kind === 'directory'));
        select.disabled = select.dataset.unavailable === 'true';
        label.append(select); body.append(label); choices.set(conflict.path, select);
    }
    for (const degraded of stored.plan.degraded) paragraph(body, t('project.sync.degraded', { path: degraded.path, attribute: degraded.attribute }));
}
