// @file: device-llm/constants/llm-loader.ts
// .llm file loader — parses YAML-based LLM configuration files.
//
// .llm files are the canonical format for defining:
//   - provider / providers — LLMProvider definitions (API endpoint + model catalog)
//   - connections          — list of Connection (provider + tier mappings)
//   - agents               — list of AgentDefinition (config + system prompt)
//   - skills               — list of LLMSkill definitions
//   - mcp                  — MCP server configs

import yaml from 'js-yaml';
import type {
    LLMProvider, DefaultConnectionDef, LLMModel, LLMConnection,
    AgentDefinition, AgentType, AgentConfig,
    LLMSkill, LLMSkillType,
    ModelTier,
} from '@itookit/common';

// ─── .llm File Types ─────────────────────────────────────────────────────────

export interface LLMModelDef {
    id: string;
    name: string;
    icon?: string;
    contextWindow?: number;
    maxOutput?: number;
    supportsVision?: boolean;
    supportsThinking?: boolean;
    supportsTools?: boolean;
    supportsAudio?: boolean;
    supportsVideo?: boolean;
    supportsStructuredOutput?: boolean;
    inputPricePerMillion?: number;
    outputPricePerMillion?: number;
}

export interface LLMProviderDef {
    id: string;
    name: string;
    implementation: string;
    baseURL: string;
    apiKey?: string;
    icon?: string;
    authMethod?: 'bearer' | 'api-key' | 'query-param';
    supportsThinking?: boolean;
    requiresReferer?: boolean;
    isBuiltin?: boolean;
    enabled?: boolean;
    defaultTemperature?: number;
    models: LLMModelDef[];
}

export interface LLMConnectionDef {
    id: string;
    name: string;
    providerId: string;
    tiers?: Record<string, string>;
}

/** Skill definition as stored in a .llm file — mirrors LLMSkill without runtime timestamps. */
export interface LLMSkillDef {
    id: string;
    name: string;
    description?: string;
    type?: string;              // LLMSkillType; defaults to 'prompt' on import
    enabled?: boolean;          // defaults to true on import
    icon?: string;
    /** Alias for `instructions` (backward compat). */
    prompt?: string;
    instructions?: string;
    // HTTP
    endpoint?: string;
    method?: string;
    headers?: Record<string, string>;
    // Shell
    command?: string;
    // Function-calling schema
    parameters?: Record<string, unknown>;
    // MCP
    mcpServerId?: string;
    mcpToolName?: string;
    // Behavior
    triggerStrategy?: string;
    autoLoad?: boolean;
    priority?: number;
    globs?: string[];
    correctionLog?: string;
    disableModelInvocation?: boolean;
    metadata?: Record<string, unknown>;
    [key: string]: unknown;
}

/** Agent definition as stored in a .llm file — mirrors AgentDefinition without runtime timestamps. */
export interface LLMAgentDef {
    id: string;
    name: string;
    type?: string;              // AgentType; defaults to 'agent' on import
    icon?: string;
    description?: string;
    config: {
        connectionId: string;
        modelTier?: string;     // ModelTier
        systemPrompt?: string;
        maxHistoryLength?: number;
        temperature?: number;
        mcpServers?: string[];
        [key: string]: unknown;
    };
    tags?: string[];
    interface?: unknown;
}

export interface LLMMCPDef {
    servers: Array<{
        name: string;
        transport: 'stdio' | 'sse' | 'websocket';
        command?: string;
        args?: string[];
        url?: string;
        env?: Record<string, string>;
    }>;
    timeout?: number;
}

/**
 * .llm file root structure.
 *
 * A single bundle file can contain any combination of:
 *   providers + connections + agents + skills + mcp
 *
 * Singular `provider` is supported for backward compatibility.
 * Use `providers` (array) when a file bundles multiple providers.
 *
 * Dependency order (import respects this order automatically):
 *   providers → connections → agents (reference connectionId) → skills → mcp
 */
export interface LLMConfigFile {
    /** Single provider — backward-compat shorthand. Prefer `providers` for new files. */
    provider?: LLMProviderDef;
    /** Multiple providers in one file. Takes precedence over singular `provider`. */
    providers?: LLMProviderDef[];
    connections?: LLMConnectionDef[];
    agents?: LLMAgentDef[];
    skills?: LLMSkillDef[];
    mcp?: LLMMCPDef;
}

/** Normalized view: always returns a (possibly empty) array of providers. */
export function getProviderDefs(config: LLMConfigFile): LLMProviderDef[] {
    if (config.providers?.length) return config.providers;
    if (config.provider) return [config.provider];
    return [];
}

// ─── Import (YAML → typed objects) ──────────────────────────────────────────

/**
 * Parse a .llm YAML string into a typed LLMConfigFile.
 * Throws on invalid YAML or missing required fields.
 */
export function parseLLMConfig(yamlContent: string): LLMConfigFile {
    const raw = yaml.load(yamlContent) as Record<string, unknown> | undefined;
    if (!raw || typeof raw !== 'object') {
        throw new Error('Invalid .llm file: root must be an object');
    }
    return {
        // Support both singular `provider` and plural `providers`
        provider: !raw.providers && raw.provider ? (raw.provider as LLMProviderDef) : undefined,
        providers: raw.providers ? (raw.providers as LLMProviderDef[]) : undefined,
        connections: raw.connections ? (raw.connections as LLMConnectionDef[]) : undefined,
        agents: raw.agents ? (raw.agents as LLMAgentDef[]) : undefined,
        skills: raw.skills ? (raw.skills as LLMSkillDef[]) : undefined,
        mcp: raw.mcp ? (raw.mcp as LLMMCPDef) : undefined,
    };
}

/**
 * Convert a parsed LLMProviderDef to the runtime LLMProvider type.
 */
export function toLLMProvider(def: LLMProviderDef): LLMProvider {
    return {
        id: def.id,
        name: def.name,
        implementation: def.implementation as LLMProvider['implementation'],
        baseURL: def.baseURL,
        icon: def.icon,
        supportsThinking: def.supportsThinking,
        requiresReferer: def.requiresReferer,
        isBuiltin: def.isBuiltin ?? true,
        enabled: def.enabled,
        defaultTemperature: def.defaultTemperature,
        authMethod: def.authMethod,
        apiKey: def.apiKey,
        models: def.models.map(m => ({ ...m } as LLMModel)),
        capabilities: {
            thinking: def.supportsThinking,
        },
    };
}

/**
 * Convert a parsed LLMSkillDef to the runtime LLMSkill type.
 * `prompt` is treated as an alias for `instructions` (backward compat).
 */
export function toRuntimeSkill(def: LLMSkillDef): LLMSkill {
    return {
        id: def.id,
        name: def.name,
        description: def.description,
        type: (def.type ?? 'prompt') as LLMSkillType,
        enabled: def.enabled ?? true,
        icon: def.icon,
        instructions: def.instructions ?? def.prompt,
        endpoint: def.endpoint,
        method: def.method as LLMSkill['method'],
        headers: def.headers,
        command: def.command,
        parameters: def.parameters,
        mcpServerId: def.mcpServerId,
        mcpToolName: def.mcpToolName,
        triggerStrategy: def.triggerStrategy as LLMSkill['triggerStrategy'],
        autoLoad: def.autoLoad,
        priority: def.priority,
        globs: def.globs,
        correctionLog: def.correctionLog,
        disableModelInvocation: def.disableModelInvocation,
        metadata: def.metadata,
        createdAt: Date.now(),
    };
}

/**
 * Convert a parsed LLMAgentDef to the runtime AgentDefinition type.
 */
export function toRuntimeAgent(def: LLMAgentDef): AgentDefinition {
    return {
        id: def.id,
        name: def.name,
        type: (def.type ?? 'agent') as AgentType,
        icon: def.icon,
        description: def.description,
        config: {
            connectionId: def.config.connectionId || 'default',
            modelTier: def.config.modelTier as ModelTier | undefined,
            systemPrompt: def.config.systemPrompt,
            maxHistoryLength: def.config.maxHistoryLength,
            temperature: def.config.temperature,
            mcpServers: def.config.mcpServers,
        } as AgentConfig,
        tags: def.tags,
        interface: def.interface as AgentDefinition['interface'],
        createdAt: Date.now(),
    };
}

/**
 * Convert a parsed LLMConnectionDef to the runtime LLMConnection type.
 * The returned connection has no apiKey (apiKey lives on the Provider).
 */
export function toRuntimeConnection(def: LLMConnectionDef): LLMConnection {
    return {
        id: def.id,
        name: def.name,
        providerId: def.providerId,
        tiers: def.tiers as LLMConnection['tiers'],
        createdAt: Date.now(),
    };
}

/**
 * Convert a parsed LLMConnectionDef to the runtime DefaultConnectionDef type.
 */
export function toConnectionDef(def: LLMConnectionDef): DefaultConnectionDef {
    const tiers: DefaultConnectionDef['tiers'] = {};
    if (def.tiers) {
        const tierKeys = ['optimal', 'standard', 'fast'] as const;
        for (const k of tierKeys) {
            if (def.tiers[k]) {
                (tiers as Record<string, string>)[k] = def.tiers[k];
            }
        }
    }
    return {
        id: def.id,
        name: def.name,
        providerId: def.providerId,
        tiers: Object.keys(tiers).length > 0 ? tiers : undefined,
    };
}

// ─── Reverse converters (runtime objects → .llm defs) ───────────────────────

/**
 * Convert runtime LLMProvider → LLMProviderDef (strips apiKey for safety).
 */
export function fromLLMProvider(p: LLMProvider): LLMProviderDef {
    return {
        id: p.id,
        name: p.name,
        implementation: p.implementation,
        baseURL: p.baseURL,
        icon: p.icon,
        authMethod: p.authMethod,
        supportsThinking: p.supportsThinking ?? p.capabilities?.thinking,
        requiresReferer: p.requiresReferer,
        isBuiltin: p.isBuiltin,
        enabled: p.enabled,
        defaultTemperature: p.defaultTemperature,
        models: p.models.map(m => ({
            id: m.id,
            name: m.name,
            icon: m.icon,
            contextWindow: m.contextWindow,
            maxOutput: m.maxOutput,
            supportsVision: m.supportsVision,
            supportsThinking: m.supportsThinking,
            supportsTools: m.supportsTools,
            inputPricePerMillion: m.inputPricePerMillion,
            outputPricePerMillion: m.outputPricePerMillion,
        })),
    };
}

/**
 * Convert runtime LLMSkill → LLMSkillDef for .llm serialization.
 * Strips runtime-only timestamps.
 */
export function fromSkillDef(skill: LLMSkill): LLMSkillDef {
    return {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        type: skill.type,
        enabled: skill.enabled,
        icon: skill.icon,
        instructions: skill.instructions,
        endpoint: skill.endpoint,
        method: skill.method,
        headers: skill.headers,
        command: skill.command,
        parameters: skill.parameters,
        mcpServerId: skill.mcpServerId,
        mcpToolName: skill.mcpToolName,
        triggerStrategy: skill.triggerStrategy,
        autoLoad: skill.autoLoad,
        priority: skill.priority,
        globs: skill.globs,
        correctionLog: skill.correctionLog,
        disableModelInvocation: skill.disableModelInvocation,
        metadata: skill.metadata,
    };
}

/**
 * Convert runtime AgentDefinition → LLMAgentDef for .llm serialization.
 * Strips runtime-only timestamps.
 */
export function fromAgentDef(agent: AgentDefinition): LLMAgentDef {
    return {
        id: agent.id,
        name: agent.name,
        type: agent.type,
        icon: agent.icon,
        description: agent.description,
        config: {
            connectionId: agent.config.connectionId,
            modelTier: agent.config.modelTier,
            systemPrompt: agent.config.systemPrompt,
            maxHistoryLength: agent.config.maxHistoryLength,
            temperature: agent.config.temperature,
            mcpServers: agent.config.mcpServers,
        },
        tags: agent.tags,
        interface: agent.interface,
    };
}

/**
 * Convert runtime DefaultConnectionDef → LLMConnectionDef (widen tiers to YAML format).
 */
export function fromConnectionDef(conn: DefaultConnectionDef): LLMConnectionDef {
    return {
        id: conn.id,
        name: conn.name,
        providerId: conn.providerId,
        tiers: conn.tiers as Record<string, string> | undefined,
    };
}

// ─── Export (typed objects → YAML) ───────────────────────────────────────────

/**
 * Serialize a LLMConfigFile to .llm YAML string.
 * Strips apiKey from provider automatically.
 */
export function serializeLLMConfig(config: LLMConfigFile): string {
    const out: Record<string, unknown> = {};

    const defs = getProviderDefs(config);
    if (defs.length === 1) {
        // Single provider → use singular key for readability / backward compat
        const { apiKey: _, ...p } = defs[0] as LLMProviderDef & { apiKey?: string };
        out.provider = p;
    } else if (defs.length > 1) {
        out.providers = defs.map(({ apiKey: _, ...p }: LLMProviderDef & { apiKey?: string }) => p);
    }

    if (config.connections?.length) {
        out.connections = config.connections;
    }
    if (config.agents?.length) {
        out.agents = config.agents;
    }
    if (config.skills?.length) {
        out.skills = config.skills;
    }
    if (config.mcp) {
        out.mcp = config.mcp;
    }

    return yaml.dump(out, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
        sortKeys: false,
    });
}

/**
 * Serialize one provider + its connections to .llm YAML.
 */
export function exportToLLM(
    provider: LLMProvider,
    connections: DefaultConnectionDef[],
): string {
    return serializeLLMConfig({
        provider: fromLLMProvider(provider),
        connections: connections.map(fromConnectionDef),
    });
}

/**
 * Serialize multiple providers + connections to a single .llm YAML bundle.
 */
export function exportBundleToLLM(
    providers: LLMProvider[],
    connections: DefaultConnectionDef[],
): string {
    return serializeLLMConfig({
        providers: providers.map(fromLLMProvider),
        connections: connections.map(fromConnectionDef),
    });
}
