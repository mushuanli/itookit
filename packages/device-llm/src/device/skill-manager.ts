// @file: device-llm/device/skill-manager.ts
//
// SkillManager — SkillDefinition CRUD, HTTP/Shell/MCP invocation.

import type { LLMSkill } from '@itookit/common';
import type { IVFSManager, IModuleFS } from '@itookit/vfs-core';
import yaml from 'js-yaml';
import { VFSHelpers } from './vfs-helpers';
import type { MCPManager } from './mcp-manager';
import type { IShellRunner } from './llm-device-driver';

const SKILLS_DIR = '/llm/.skills';

export class SkillManager {
    private _skills: LLMSkill[] = [];

    constructor(
        private readonly helpers: VFSHelpers,
        private readonly vfs: IVFSManager,
        private readonly mcpManager: MCPManager,
        private readonly shellRunner: IShellRunner | undefined,
        private readonly onChanged: () => void,
    ) {}

    // ─── Read accessors ────────────────────────────────────────────────────

    getSkills(): LLMSkill[] {
        return [...this._skills];
    }

    getRawSkills(): LLMSkill[] {
        return this._skills;
    }

    findSkill(id: string): LLMSkill | undefined {
        return this._skills.find(s => s.id === id);
    }

    // ─── Mutations ─────────────────────────────────────────────────────────

    async saveSkill(skill: LLMSkill, systemFS?: IModuleFS): Promise<void> {
        skill = { ...skill, modifiedAt: Date.now() };
        await this.writeSkillToDisk(skill, systemFS);
        const idx = this._skills.findIndex(s => s.id === skill.id);
        if (idx >= 0) { this._skills[idx] = skill; } else { this._skills.push(skill); }
        await this.vfs.createDeviceNode('llm', `/dev/llm/skills/${skill.id}`, {
            resourceType: 'skill',
            resourceId: skill.id,
        });
        this.onChanged();
    }

    async deleteSkill(id: string, systemFS?: IModuleFS): Promise<void> {
        await this.deleteSkillFromDisk(id, systemFS);
        this._skills = this._skills.filter(s => s.id !== id);
        await this.vfs.removeDeviceNode(`/dev/llm/skills/${id}`);
        this.onChanged();
    }

    // ─── Init helpers ──────────────────────────────────────────────────────

    setSkills(skills: LLMSkill[]): void {
        this._skills = skills;
    }

    // ─── VFS reload ────────────────────────────────────────────────────────

    async reload(): Promise<void> {
        this._skills = await this.loadAllSkills();
    }

    // ─── Invocation ────────────────────────────────────────────────────────

    async invokeSkill(skill: LLMSkill, args: Record<string, unknown>): Promise<unknown> {
        switch (skill.type) {
            case 'http':
                return this.invokeHttpSkill(skill, args);
            case 'shell':
                return this.invokeShellSkill(skill, args);
            case 'mcp':
                return this.invokeMcpSkill(skill, args);
            case 'prompt':
                return `[Skill '${skill.name}' provides context instructions — it is not a callable tool.]`;
            default:
                throw new Error(`Skill '${skill.id}': type '${skill.type}' is not invocable`);
        }
    }

    // ─── Private helpers ───────────────────────────────────────────────────

    private async loadAllSkills(): Promise<LLMSkill[]> {
        const raw = await this.helpers.loadJsonFilesFromDir<any>(SKILLS_DIR);
        return raw;
    }

    private async writeSkillToDisk(skill: LLMSkill, systemFS?: IModuleFS): Promise<void> {
        const fs = systemFS ?? this.helpers.getEngine();
        await this.helpers.engineUpsert(
            `${SKILLS_DIR}/${skill.id}.yaml`,
            yaml.dump(skill, { lineWidth: -1, noRefs: true }),
            systemFS,
        );
        // Remove legacy .json file if present (one-time migration on first save).
        const oldId = await fs.driver.resolvePath(`${SKILLS_DIR}/${skill.id}.json`);
        if (oldId) await fs.driver.delete([oldId]);
    }

    private async deleteSkillFromDisk(id: string, systemFS?: IModuleFS): Promise<void> {
        const fs = systemFS ?? this.helpers.getEngine();
        for (const ext of ['.yaml', '.json']) {
            const nodeId = await fs.driver.resolvePath(`${SKILLS_DIR}/${id}${ext}`);
            if (nodeId) { await fs.driver.delete([nodeId]); break; }
        }
    }

    private async invokeHttpSkill(skill: LLMSkill, args: Record<string, unknown>): Promise<unknown> {
        if (!skill.endpoint) throw new Error(`Skill '${skill.id}' has no endpoint configured`);
        const response = await fetch(skill.endpoint, {
            method: skill.method ?? 'POST',
            headers: { 'Content-Type': 'application/json', ...skill.headers },
            body: JSON.stringify(args),
        });
        if (!response.ok) throw new Error(`Skill '${skill.name}' invocation failed: HTTP ${response.status}`);
        const ct = response.headers.get('content-type') ?? '';
        return ct.includes('application/json') ? response.json() : response.text();
    }

    private async invokeShellSkill(skill: LLMSkill, args: Record<string, unknown>): Promise<string> {
        const shellTool = skill.tools?.find(t => t.executionType === 'shell');
        const command = shellTool?.command;
        if (!command) throw new Error(`Skill '${skill.id}' has no command configured`);
        if (!this.shellRunner) {
            return (
                `Shell skills require a native execution environment.\n` +
                `Inject an IShellRunner when constructing LLMDeviceDriver, or use the kernel path.`
            );
        }
        return this.shellRunner.run(command, args);
    }

    private async invokeMcpSkill(skill: LLMSkill, args: Record<string, unknown>): Promise<unknown> {
        const { mcpServerId, mcpToolName } = skill;
        if (!mcpServerId || !mcpToolName) {
            throw new Error(`MCP skill '${skill.id}' requires mcpServerId and mcpToolName`);
        }
        const conn = await this.mcpManager.getOrConnectServer(mcpServerId, this.mcpManager.getServers());
        const result = await conn.callTool(mcpToolName, args);
        return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    }
}

