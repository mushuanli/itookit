// @file: llm-common/src/llm/node-config.ts
// Unified LLM node configuration shared by long-lived Agents and ephemeral
// Flow nodes. Both reference configuration entities (system prompt, tools,
// skills, connection) by id, so editing an entity updates every referrer.

import type { ModelTier } from './connection';

/** How an LLM node assembles its conversation history. */
export type HistoryPolicy = 'inherit' | 'none' | 'upstream';
/** How inherited and node-local system prompts are composed. */
export type SystemPromptPolicy = 'inherit' | 'replace' | 'none';

/** A quick prompt preset (shortcut shown in the chat input dropdown). */
export interface PromptPreset {
    name: string;
    prompt: string;
}

/** A reusable system-prompt entry in the System Prompt library (settings). */
export interface SystemPromptDefinition {
    id: string;
    name: string;
    description?: string;
    /** Multiple system segments (each becomes a role:'system' message). */
    content: string[];
    /** Quick prompt presets — part of the entry, but not referenced by flow nodes. */
    presets?: PromptPreset[];
}

/** Long-term memory policy (long-lived Agents only; flow nodes do not inherit). */
export interface MemoryPolicy {
    namespaceId: string;
    readScopes: string[];
    writeScopes: string[];
    retrievalLimit?: number;
}

/**
 * Unified node configuration: reference configuration entities by id plus
 * inline additions/overrides. Resolved at run time (see design doc §3).
 */
export interface LlmNodeConfig {
    // ── References to configuration entities (edit once, applies everywhere) ──
    /** Reference a System Prompt library entry. */
    systemPromptId?: string;
    /** Directly reference tools (tools are standalone entities; no ToolSet layer). */
    toolIds?: string[];
    /** Reference skills (progressive disclosure / static load). */
    skillIds?: string[];
    /** Reference MCP profiles. */
    mcpProfileIds?: string[];
    /** Reference a connection. */
    connectionId?: string;

    // ── Inline additions (appended after referenced content) ──
    /** Node task instructions, appended as extra system segments. */
    systemPrompt?: string[];

    // ── Model ──
    modelTier?: ModelTier;
    modelName?: string;
    temperature?: number;
    thinking?: boolean;
    reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
    maxTokens?: number;
    stream?: boolean;
    webSearch?: boolean;

    // ── Execution policy ──
    maxExchanges?: number;
    /** Per LLM request timeout. */
    timeoutMs?: number;
    approval?: 'none' | 'external' | 'all';
    historyPolicy?: HistoryPolicy;
    systemPromptPolicy?: SystemPromptPolicy;
    persistOutput?: boolean;
    recordToolCalls?: boolean;
    recordThinking?: boolean;
    workingDirectory?: string;

    // ── Memory (long-lived Agents only) ──
    memoryPolicy?: MemoryPolicy;
}
