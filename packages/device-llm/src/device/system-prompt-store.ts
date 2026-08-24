// @file: device-llm/device/system-prompt-store.ts
// /llm/systemprompt seqfile: key = agent id, value = SystemPromptDefinition
// (system segments + quick-prompt presets). Seeded from DEFAULT_AGENTS on init.

import type { IModuleFS } from '@itookit/vfs-core';
import type { SystemPromptDefinition } from '@itookit/common';
import { DEFAULT_AGENTS } from '../constants/agents';

const SYSTEM_PROMPT_PATH = '/llm/systemprompt';
const SYSTEM_PROMPT_NAME = 'systemprompt';
const SYSTEM_PROMPT_PARENT = '/llm';

export class SystemPromptStore {
    constructor(private readonly engine: IModuleFS) {}

    /** Ensure /llm/systemprompt seqfile exists (init-time, mirrors CostStore). */
    async ensureFile(): Promise<void> {
        const seq = this.engine.meta.seq;
        if (!seq) return; // backend doesn't support seqfiles, skip silently
        const exists = await this.engine.driver.exists(SYSTEM_PROMPT_PATH);
        if (exists) return;
        const parentExists = await this.engine.driver.exists(SYSTEM_PROMPT_PARENT);
        if (!parentExists) {
            await this.engine.driver.createDirectory({ name: 'llm', parentPath: null });
        }
        await this.engine.driver.createFile({
            name: SYSTEM_PROMPT_NAME,
            parentPath: SYSTEM_PROMPT_PARENT,
            type: 'seqfile',
        });
    }

    /** Seed default agents' system prompts + quick-prompt presets (idempotent). */
    async seedDefaults(): Promise<void> {
        const seq = this.engine.meta.seq;
        if (!seq) return;
        for (const def of DEFAULT_AGENTS) {
            const existing = await seq.getEntry(SYSTEM_PROMPT_PATH, def.id);
            if (existing) continue;
            const entry: SystemPromptDefinition = {
                id: def.id,
                name: def.name,
                description: def.description,
                content: [def.config.systemPrompt].filter((s): s is string => Boolean(s)),
                ...(def.defaultPrompts?.length ? { presets: def.defaultPrompts } : {}),
            };
            await seq.setEntry(SYSTEM_PROMPT_PATH, def.id, JSON.stringify(entry));
        }
    }

    async getSystemPrompt(agentId: string): Promise<SystemPromptDefinition | null> {
        const seq = this.engine.meta.seq;
        if (!seq) return null;
        const raw = await seq.getEntry(SYSTEM_PROMPT_PATH, agentId);
        if (!raw) return null;
        try {
            return JSON.parse(raw) as SystemPromptDefinition;
        } catch {
            return null;
        }
    }
}
