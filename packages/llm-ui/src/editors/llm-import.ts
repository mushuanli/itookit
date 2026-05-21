// @file: llm-ui/editors/llm-import.ts
//
// Shared import logic for .llm bundle files.
//
// Handles:
//   - Conflict detection (providers / connections / agents / skills)
//   - Conflict resolution modal (skip / overwrite / rename)
//   - Cascading ID remapping on rename (provider → connections → agents)
//   - Executing the import in dependency order

import { Modal, Toast } from '@itookit/common';
import type { IConnectionService } from '@itookit/common';
import {
    parseLLMConfig,
    toLLMProvider, toRuntimeConnection, toRuntimeAgent, toRuntimeSkill,
    getProviderDefs,
    type LLMConfigFile, type LLMAgentDef, type LLMConnectionDef,
} from '@itookit/device-llm';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConflictStrategy = 'skip' | 'overwrite' | 'rename';

export interface ConflictItem {
    type: 'provider' | 'connection' | 'agent' | 'skill';
    id: string;
    name: string;
}

export interface ImportStats {
    providers: number;
    connections: number;
    agents: number;
    skills: number;
    skipped: number;
}

// Duck-typed agent management service (superset of IConnectionService)
interface AgentSvc {
    getAgents(): Promise<Array<{ id: string }>>;
    saveAgent(a: unknown): Promise<void>;
    getSkills(): Promise<Array<{ id: string }>>;
    saveSkill(s: unknown): Promise<void>;
}

function asAgentSvc(service: IConnectionService): AgentSvc | null {
    return 'saveAgent' in service ? service as unknown as AgentSvc : null;
}

// ─── ID helpers ───────────────────────────────────────────────────────────────

/** Find the first non-conflicting ID: `base` → `base-2` → `base-3` … */
function resolveConflictId(base: string, existingIds: Set<string>): string {
    if (!existingIds.has(base)) return base;
    let n = 2;
    while (existingIds.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
}

// ─── Conflict detection ───────────────────────────────────────────────────────

export async function detectConflicts(
    config: LLMConfigFile,
    service: IConnectionService,
): Promise<ConflictItem[]> {
    const conflicts: ConflictItem[] = [];

    const existingProviders = new Set(service.getProviders().map(p => p.id));
    for (const def of getProviderDefs(config)) {
        if (existingProviders.has(def.id)) {
            conflicts.push({ type: 'provider', id: def.id, name: def.name });
        }
    }

    const existingConns = new Set((await service.getConnections()).map(c => c.id));
    for (const def of (config.connections ?? [])) {
        if (existingConns.has(def.id)) {
            conflicts.push({ type: 'connection', id: def.id, name: def.name });
        }
    }

    const agentSvc = asAgentSvc(service);
    if (agentSvc) {
        const existingAgents = new Set((await agentSvc.getAgents()).map(a => a.id));
        for (const def of (config.agents ?? [])) {
            if (existingAgents.has(def.id)) {
                conflicts.push({ type: 'agent', id: def.id, name: def.name });
            }
        }

        const existingSkills = new Set((await agentSvc.getSkills()).map(s => s.id));
        for (const def of (config.skills ?? [])) {
            if (existingSkills.has(def.id)) {
                conflicts.push({ type: 'skill', id: def.id, name: def.name });
            }
        }
    }

    return conflicts;
}

// ─── Conflict resolution modal ────────────────────────────────────────────────

const TYPE_LABELS: Record<ConflictItem['type'], string> = {
    provider: 'Provider',
    connection: '连接',
    agent: 'Agent',
    skill: 'Skill',
};

/**
 * Show a conflict resolution modal.
 * Resolves with the chosen strategy, or `null` if user cancels.
 */
export function showConflictModal(conflicts: ConflictItem[]): Promise<ConflictStrategy | null> {
    return new Promise((resolve) => {
        const grouped: Partial<Record<ConflictItem['type'], ConflictItem[]>> = {};
        for (const c of conflicts) {
            (grouped[c.type] ??= []).push(c);
        }

        const listHtml = (Object.entries(grouped) as [ConflictItem['type'], ConflictItem[]][])
            .map(([type, items]) => `
                <div style="margin-bottom:8px">
                    <strong>${TYPE_LABELS[type]}</strong>：
                    ${items.map(i => `<code style="font-size:.8rem;background:var(--st-bg-secondary,#f5f5f5);padding:1px 4px;border-radius:3px">${i.id}</code>`).join(' ')}
                </div>
            `).join('');

        const body = `
            <p style="margin:0 0 12px;font-size:.875rem;color:var(--st-text-secondary)">
                发现 <strong>${conflicts.length}</strong> 个 ID 与现有配置冲突：
            </p>
            <div style="margin-bottom:16px;padding:10px 12px;background:var(--st-bg-secondary,#f8f8f8);border-radius:6px;font-size:.85rem">
                ${listHtml}
            </div>
            <fieldset style="border:none;padding:0;margin:0">
                <legend style="font-size:.875rem;font-weight:600;margin-bottom:8px">处理方式</legend>
                <label style="display:flex;align-items:flex-start;gap:8px;margin-bottom:10px;cursor:pointer">
                    <input type="radio" name="conflict-strategy" value="skip" style="margin-top:3px">
                    <span>
                        <strong>跳过</strong>
                        <span style="display:block;font-size:.8rem;color:var(--st-text-secondary)">保留现有配置，仅导入不冲突的项目</span>
                    </span>
                </label>
                <label style="display:flex;align-items:flex-start;gap:8px;margin-bottom:10px;cursor:pointer">
                    <input type="radio" name="conflict-strategy" value="overwrite" checked style="margin-top:3px">
                    <span>
                        <strong>覆盖</strong>
                        <span style="display:block;font-size:.8rem;color:var(--st-text-secondary)">用导入内容替换现有配置（API Key 不受影响）</span>
                    </span>
                </label>
                <label style="display:flex;align-items:flex-start;gap:8px;cursor:pointer">
                    <input type="radio" name="conflict-strategy" value="rename" style="margin-top:3px">
                    <span>
                        <strong>重命名</strong>
                        <span style="display:block;font-size:.8rem;color:var(--st-text-secondary)">自动为导入项追加 -2、-3 后缀，与现有并存</span>
                    </span>
                </label>
            </fieldset>
        `;

        new Modal('导入冲突', body, {
            confirmText: '确认导入',
            width: '480px',
            onConfirm: () => {
                const radio = document.querySelector(
                    'input[name="conflict-strategy"]:checked',
                ) as HTMLInputElement | null;
                resolve((radio?.value as ConflictStrategy) ?? 'overwrite');
            },
            onCancel: () => resolve(null),
        }).show();
    });
}

// ─── Execute import ───────────────────────────────────────────────────────────

/**
 * Apply remapping to connections that reference renamed providers,
 * and to agents that reference renamed connections.
 */
function applyRemap(
    config: LLMConfigFile,
    providerRemap: Map<string, string>,
    connRemap: Map<string, string>,
): LLMConfigFile {
    const connections: LLMConnectionDef[] = (config.connections ?? []).map(c => ({
        ...c,
        id: connRemap.get(c.id) ?? c.id,
        providerId: providerRemap.get(c.providerId) ?? c.providerId,
    }));

    const agents: LLMAgentDef[] = (config.agents ?? []).map(a => ({
        ...a,
        config: {
            ...a.config,
            connectionId: connRemap.get(a.config.connectionId) ?? a.config.connectionId,
        },
    }));

    return { ...config, connections, agents };
}

/**
 * Execute a .llm import with the given conflict strategy.
 * Returns counts of successfully imported items.
 */
export async function executeImport(
    config: LLMConfigFile,
    service: IConnectionService,
    strategy: ConflictStrategy,
): Promise<ImportStats> {
    const stats: ImportStats = { providers: 0, connections: 0, agents: 0, skills: 0, skipped: 0 };
    const agentSvc = asAgentSvc(service);

    // ── Build existing-ID sets ────────────────────────────────────────────────
    const existingProviders = new Set(service.getProviders().map(p => p.id));
    const existingConns     = new Set((await service.getConnections()).map(c => c.id));
    const existingAgents    = agentSvc ? new Set((await agentSvc.getAgents()).map(a => a.id)) : new Set<string>();
    const existingSkills    = agentSvc ? new Set((await agentSvc.getSkills()).map(s => s.id)) : new Set<string>();

    // ── Build remapping tables for 'rename' (cascades: provider → conn → agent) ─
    const providerRemap = new Map<string, string>();
    const connRemap     = new Map<string, string>();

    if (strategy === 'rename') {
        const allocatedProviders = new Set(existingProviders);
        for (const def of getProviderDefs(config)) {
            if (existingProviders.has(def.id)) {
                const newId = resolveConflictId(def.id, allocatedProviders);
                providerRemap.set(def.id, newId);
                allocatedProviders.add(newId);
            }
        }
        const allocatedConns = new Set(existingConns);
        for (const def of (config.connections ?? [])) {
            if (existingConns.has(def.id)) {
                const newId = resolveConflictId(def.id, allocatedConns);
                connRemap.set(def.id, newId);
                allocatedConns.add(newId);
            }
        }
    }

    // ── Apply remap to dependent items ────────────────────────────────────────
    const resolved = (strategy === 'rename') ? applyRemap(config, providerRemap, connRemap) : config;

    // ── Providers ─────────────────────────────────────────────────────────────
    // resolved.providers already has remapped IDs; original IDs are in config
    const originalProviderDefs = getProviderDefs(config);
    for (let i = 0; i < getProviderDefs(resolved).length; i++) {
        const def = getProviderDefs(resolved)[i];
        const originalId = originalProviderDefs[i]?.id ?? def.id;

        if (strategy === 'skip' && existingProviders.has(originalId)) {
            stats.skipped++;
            continue;
        }
        // Preserve existing apiKey on overwrite (look up by original id)
        const existingFull = strategy === 'overwrite' ? service.getFullProvider?.(originalId) : undefined;
        await service.saveProvider(toLLMProvider({
            ...def,
            isBuiltin: false,
            apiKey: existingFull?.apiKey ?? def.apiKey,
        }));
        stats.providers++;
    }

    // ── Connections ───────────────────────────────────────────────────────────
    for (const def of (resolved.connections ?? [])) {
        if (strategy === 'skip' && existingConns.has(def.id)) {
            stats.skipped++;
            continue;
        }
        await service.saveConnection(toRuntimeConnection(def));
        stats.connections++;
    }

    // ── Agents ────────────────────────────────────────────────────────────────
    if (agentSvc) {
        const allocatedAgents = new Set(existingAgents);
        for (const def of (resolved.agents ?? [])) {
            let effectiveDef = def;
            if (strategy === 'skip' && existingAgents.has(def.id)) {
                stats.skipped++;
                continue;
            }
            if (strategy === 'rename' && existingAgents.has(def.id)) {
                const newId = resolveConflictId(def.id, allocatedAgents);
                allocatedAgents.add(newId);
                effectiveDef = { ...def, id: newId };
            }
            await agentSvc.saveAgent(toRuntimeAgent(effectiveDef));
            stats.agents++;
        }

        // ── Skills ────────────────────────────────────────────────────────────
        const allocatedSkills = new Set(existingSkills);
        for (const def of (resolved.skills ?? [])) {
            let effectiveDef = def;
            if (strategy === 'skip' && existingSkills.has(def.id)) {
                stats.skipped++;
                continue;
            }
            if (strategy === 'rename' && existingSkills.has(def.id)) {
                const newId = resolveConflictId(def.id, allocatedSkills);
                allocatedSkills.add(newId);
                effectiveDef = { ...def, id: newId };
            }
            await agentSvc.saveSkill(toRuntimeSkill(effectiveDef));
            stats.skills++;
        }
    }

    return stats;
}

// ─── Main entry: parse files + detect + show modal + execute ─────────────────

/**
 * Full import flow: parse .llm files → detect conflicts → resolve → execute.
 * Call this from editor `importLLMFiles` handlers.
 *
 * Returns `true` if import completed (even partially), `false` if user cancelled.
 */
export async function runLLMImport(
    files: FileList,
    service: IConnectionService,
): Promise<boolean> {
    // Parse all files, merge into one config
    const merged: LLMConfigFile = {
        providers: [],
        connections: [],
        agents: [],
        skills: [],
    };
    const errors: string[] = [];

    for (const file of Array.from(files)) {
        try {
            const config = parseLLMConfig(await file.text());
            merged.providers!.push(...getProviderDefs(config));
            merged.connections!.push(...(config.connections ?? []));
            merged.agents!.push(...(config.agents ?? []));
            merged.skills!.push(...(config.skills ?? []));
        } catch (err) {
            errors.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    if (errors.length) {
        Toast.error(`文件解析失败:\n${errors.join('\n')}`);
        return false;
    }

    // Detect conflicts
    const conflicts = await detectConflicts(merged, service);

    let strategy: ConflictStrategy = 'overwrite';
    if (conflicts.length > 0) {
        const chosen = await showConflictModal(conflicts);
        if (chosen === null) return false;  // user cancelled
        strategy = chosen;
    }

    // Execute
    const stats = await executeImport(merged, service, strategy);

    // Toast result
    const parts: string[] = [];
    if (stats.providers)   parts.push(`${stats.providers} 个 Provider`);
    if (stats.connections) parts.push(`${stats.connections} 个连接`);
    if (stats.agents)      parts.push(`${stats.agents} 个 Agent`);
    if (stats.skills)      parts.push(`${stats.skills} 个 Skill`);
    if (stats.skipped)     parts.push(`${stats.skipped} 项已跳过`);

    if (parts.length) Toast.success(`导入完成：${parts.join('，')}`);
    else Toast.success('导入完成（无新内容）');

    return true;
}
