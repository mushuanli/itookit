// @file llm-ui/editors/skill/SkillOperations.ts
// CRUD operations for SkillSettingsEditor — extracted for stability.
// Infrequently modified: operation patterns are stable; only types change.

import {generateShortUUID, t, SKILL_TYPE_META} from '@itookit/common';
import { Modal } from '@itookit/ui-common';
import type { LLMSkill,
    SkillType,
    IAgentManagementService
} from '@itookit/common';
import { Toast } from '@itookit/ui-common';

export interface SkillOperationsDeps {
    service: IAgentManagementService;
    container: HTMLElement;
    render: () => Promise<void>;
    val: (name: string) => string;
    chk: (name: string) => boolean;
    get selectedId(): string | null;
    set selectedId(id: string | null);
    syncMetadata: (patch: Record<string, unknown>) => Promise<void>;
    syncName: (newName: string) => Promise<void>;
    /** BaseSettingsEditor helper to resize the header name input. */
    resizeHeaderInput?: (input: HTMLInputElement) => void;
}

export async function addNew(deps: SkillOperationsDeps): Promise<void> {
    const skill: LLMSkill = {
        id:              `skill-${generateShortUUID()}`,
        name:            'New Skill',
        type:            'prompt',
        enabled:         false,
        description:     '',
        instructions:    '',
        tools:           [],
        triggerPatterns: [],
        autoLoad:        false,
        priority:        50,
        createdAt:       Date.now(),
        modifiedAt:      Date.now(),
    };
    await deps.service.saveSkill(skill);
    deps.selectedId = skill.id;
    await deps.render();
}

export async function saveCurrent(deps: SkillOperationsDeps): Promise<void> {
    if (!deps.selectedId) return;

    const skills  = await deps.service.getSkills();
    const existing = skills.find(s => s.id === deps.selectedId);
    if (!existing) return;

    // Parse parameters JSON
    let parameters: Record<string, unknown> | undefined;
    const rawParams = deps.val('parameters').trim();
    if (rawParams) {
        try { parameters = JSON.parse(rawParams); }
        catch { Toast.error(t('skill.toast.invalidParams')); return; }
    }

    // Build headers
    let headers: Record<string, string> | undefined;
    const authVal = deps.val('auth-header').trim();
    const rawHdrs = deps.val('headers').trim();
    if (rawHdrs) {
        try { headers = JSON.parse(rawHdrs); }
        catch { Toast.error(t('skill.toast.invalidHeaders')); return; }
    }
    if (authVal) headers = { ...(headers ?? {}), Authorization: authVal };

    const type = deps.val('type') as SkillType;
    const rawId  = deps.val('id').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    const newId  = rawId || existing.id;
    const idChanged = newId !== existing.id;

    if (idChanged) {
        const conflict = skills.find(s => s.id === newId);
        if (conflict) {
            Toast.error(`ID "${newId}" is already used by "${conflict.name}"`);
            return;
        }
    }

    const globs = deps.val('globs').split('\n').map((s: string) => s.trim()).filter(Boolean);
    const updated: LLMSkill = {
        ...existing,
        id:           newId,
        name:         deps.val('header-name') || existing.name,
        icon:         deps.val('header-icon') || undefined,
        description:  deps.val('description') || existing.description,
        type,
        enabled:      deps.chk('enabled'),
        instructions: type === 'prompt' ? (deps.val('instructions') || existing.instructions) : existing.instructions,
        command:      type === 'shell'  ? (deps.val('command')      || undefined) : undefined,
        mcpServerId:  type === 'mcp'    ? (deps.val('mcpServerId')  || undefined) : undefined,
        mcpToolName:  type === 'mcp'    ? (deps.val('mcpToolName')  || undefined) : undefined,
        endpoint:     type === 'http'   ? (deps.val('endpoint')     || undefined) : undefined,
        method:       type === 'http'   ? ((deps.val('method') || 'POST') as LLMSkill['method']) : undefined,
        headers:      type === 'http'   ? headers : undefined,
        parameters:   (type !== 'prompt' && type !== 'mcp') ? parameters : undefined,
        triggerStrategy: (deps.val('triggerStrategy') || 'reference') as LLMSkill['triggerStrategy'],
        autoLoad:     deps.chk('autoLoad'),
        priority:     parseInt(deps.val('priority') || '50', 10),
        globs:        globs.length > 0 ? globs : undefined,
        correctionLog: deps.val('correctionLog').trim() ? {
            path: deps.val('correctionLog').trim(),
            enabled: true,
        } : undefined,
        disableModelInvocation: deps.chk('disableModelInvocation') || undefined,
        modifiedAt:   Date.now(),
    };

    if (idChanged) {
        await deps.service.saveSkill(updated);
        await deps.service.deleteSkill(existing.id);
        deps.selectedId = newId;
    } else {
        await deps.service.saveSkill(updated);
    }
    Toast.success(t('skill.toast.saved'));
    await deps.render();
}

export function deleteCurrent(deps: SkillOperationsDeps): void {
    if (!deps.selectedId) return;
    Modal.confirm(t('dialog.delete.title'), t('skill.confirm.delete'), async () => {
        await deps.service.deleteSkill(deps.selectedId!);
        deps.selectedId = null;
        Toast.success(t('skill.toast.deleted'));
        await deps.render();
    });
}

export async function testCurrent(deps: SkillOperationsDeps): Promise<void> {
    const skills = await deps.service.getSkills();
    const skill  = skills.find(s => s.id === deps.selectedId);
    if (!skill) return;
    if (skill.type === 'prompt') { Toast.info(t('skill.toast.testPrompt')); return; }
    if (skill.type === 'mcp')    { Toast.info(t('skill.toast.testMcp')); return; }
    if (skill.type !== 'http')   { Toast.error(t('skill.toast.testNotHttp')); return; }
    if (!skill.endpoint)         { Toast.error(t('skill.toast.testNoEndpoint')); return; }

    const btn = deps.container.querySelector<HTMLButtonElement>('[data-action="test"]');
    if (!btn) return;
    const originalHTML = btn.innerHTML;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${t('status.testing')}`;
    btn.disabled  = true;

    try {
        const res = await fetch(skill.endpoint, {
            method:  skill.method ?? 'POST',
            headers: { 'Content-Type': 'application/json', ...skill.headers },
            body:    JSON.stringify({}),
        });
        res.ok ? Toast.success(t('skill.toast.testSuccess', { status: res.status }))
               : Toast.error(t('skill.toast.testFailed', { status: res.status }));
    } catch (e: unknown) {
        Toast.error(t('skill.toast.testError', { message: (e as Error).message }));
    } finally {
        btn.innerHTML = originalHTML;
        btn.disabled  = false;
    }
}

export async function saveNameOnly(deps: SkillOperationsDeps, newName: string): Promise<void> {
    if (!deps.selectedId || !newName) return;
    const skills = await deps.service.getSkills();
    const skill  = skills.find(s => s.id === deps.selectedId);
    if (!skill || skill.name === newName) return;

    await deps.syncName(newName);

    const sidebarTitle = deps.container.querySelector<HTMLElement>(`[data-name-for="${deps.selectedId}"]`);
    if (sidebarTitle && !sidebarTitle.querySelector('input')) {
        sidebarTitle.textContent = newName;
    }
    const formInput = deps.container.querySelector<HTMLInputElement>('[name="name"]');
    if (formInput) formInput.value = newName;
}

export async function saveIconOnly(deps: SkillOperationsDeps, newIcon: string): Promise<void> {
    if (!deps.selectedId) return;
    const skills = await deps.service.getSkills();
    const skill  = skills.find(s => s.id === deps.selectedId);
    if (!skill) return;
    const normalised = newIcon || undefined;
    if (skill.icon === normalised) return;

    await deps.syncMetadata({ icon: normalised });

    const sidebarIcon = deps.container.querySelector<HTMLElement>(
        `.settings-list-item[data-id="${deps.selectedId}"] .settings-list-item__icon`
    );
    if (sidebarIcon) {
        const meta = SKILL_TYPE_META[skill.type] ?? SKILL_TYPE_META.custom;
        sidebarIcon.textContent = newIcon || meta.icon;
    }
}
