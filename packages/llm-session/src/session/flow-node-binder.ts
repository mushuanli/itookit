import {
    DELEGATION_LIMITS,
    type ChatMessage,
    type ContextSnapshot,
    type FlowNodeDefinition,
    type LLMSkill,
} from '@itookit/common';
import type { ExecutionTask, ExecutorConfig } from '../core/types';
import { log } from '../utils/logger';
import { AgentResolver } from './agent-resolver';

interface BindingSetup {
    config: ExecutorConfig;
    roundId: string;
}

interface BindingContext {
    flowDefaults: Record<string, unknown>;
    snapshot: ContextSnapshot;
    task: ExecutionTask;
    setup: BindingSetup;
    agents: AgentResolver;
}

interface AgentSource {
    id: string;
    name: string;
    config: Record<string, unknown>;
    capabilities: string[];
}

interface IdentityLayer {
    referencedAgent?: ExecutorConfig;
    skills: LLMSkill[];
}

export async function bindFlowNode(
    node: FlowNodeDefinition,
    flowDefaultsValue: FlowNodeDefinition['config'] | undefined,
    snapshot: ContextSnapshot,
    task: ExecutionTask,
    setup: BindingSetup,
    agents: AgentResolver,
) {
    if (node.plugin !== 'builtin.agent') {
        return { inputs: { ...node.inputs, prompt: task.input.text } };
    }
    return bindAgentSource({
        id: String(node.id),
        name: node.name,
        config: normalizeLegacyFields(record(node.config)),
        capabilities: node.capabilities ?? [],
    }, { flowDefaults: normalizeLegacyFields(record(flowDefaultsValue)), snapshot, task, setup, agents });
}

async function bindAgentSource(source: AgentSource, context: BindingContext, templateDepth = 0) {
    const identity = await resolveIdentity(source.config, context);
    const messages = await resolveMessages(source.config, identity, context);
    const toolIds = resolveCapabilities(source, identity, context);
    const config = resolveExecutionConfig(source.config, identity.referencedAgent, context);
    const delegation = await resolveDelegation(source, messages, context, templateDepth);
    return {
        config: {
            ...config,
            messages,
            sessionId: context.task.sessionId,
            roundId: `${context.setup.roundId}:${source.id}`,
            toolIds,
            ...(delegation ? { delegation } : {}),
        } as never,
        capabilities: toolIds,
    };
}

async function resolveIdentity(
    config: Record<string, unknown>,
    context: BindingContext,
): Promise<IdentityLayer> {
    const agentId = stringValue(config.agentId) ?? stringValue(context.flowDefaults.agentId);
    const referencedAgent = agentId ? await resolveAgent(agentId, context.agents) : undefined;
    const skillIds = unique([
        ...(context.setup.config.capabilityPolicy?.skillIds ?? []),
        ...strings(context.flowDefaults.skillIds),
        ...(referencedAgent?.capabilityPolicy?.skillIds ?? []),
        ...strings(config.skillIds),
    ]);
    const skills = await context.agents.getSkills(skillIds).catch(error => {
        log.warn('Flow node skillIds resolution failed', { skillIds, error });
        return [];
    });
    return { referencedAgent, skills };
}

async function resolveAgent(id: string, agents: AgentResolver): Promise<ExecutorConfig | undefined> {
    try {
        return await agents.resolveExact(id);
    } catch (error) {
        log.warn('Flow node agentId resolution failed, falling back to session agent', { agentId: id, error });
        return undefined;
    }
}

async function resolveMessages(
    config: Record<string, unknown>,
    identity: IdentityLayer,
    context: BindingContext,
): Promise<ChatMessage[]> {
    const segments = await resolvePromptSegments(config, identity, context);
    const base = historyPolicy(config, context.flowDefaults) === 'inherit'
        ? context.snapshot.canonicalMessages.filter(message => message.role !== 'system')
        : context.task.input.text ? [{ role: 'user' as const, content: context.task.input.text }] : [];
    return [...segments.map(content => ({ role: 'system' as const, content })), ...base];
}

async function resolvePromptSegments(
    config: Record<string, unknown>,
    identity: IdentityLayer,
    context: BindingContext,
): Promise<string[]> {
    const policy = systemPromptPolicy(config, context.flowDefaults);
    const [flowReference, nodeReference] = await Promise.all([
        resolvePromptReference(
            stringValue(context.flowDefaults.systemPromptId) === stringValue(config.systemPromptId)
                ? undefined
                : stringValue(context.flowDefaults.systemPromptId),
            context.agents,
            'Flow default',
        ),
        resolvePromptReference(stringValue(config.systemPromptId), context.agents, 'Flow node'),
    ]);
    return policy === 'none' ? [] : [
        ...(policy === 'inherit' ? context.setup.config.systemPrompt ?? [] : []),
        ...(policy === 'inherit' ? flowReference : []),
        ...(policy === 'inherit' ? strings(context.flowDefaults.systemPrompt) : []),
        ...(policy === 'inherit' ? identity.referencedAgent?.systemPrompt ?? [] : []),
        ...nodeReference,
        ...identity.skills.map(skill => skill.instructions).filter(Boolean),
        ...strings(config.systemPrompt),
        ...taskInstruction(config),
    ];
}

async function resolvePromptReference(
    id: string | undefined,
    agents: AgentResolver,
    owner: string,
): Promise<string[]> {
    if (!id) return [];
    try {
        return (await agents.getSystemPrompt(id))?.content ?? [];
    } catch (error) {
        log.warn(`${owner} systemPromptId resolution failed`, { systemPromptId: id, error });
        return [];
    }
}

function resolveCapabilities(
    source: AgentSource,
    identity: IdentityLayer,
    context: BindingContext,
): string[] {
    return unique([
        ...(context.setup.config.capabilityPolicy?.toolIds ?? []),
        ...strings(context.flowDefaults.toolIds),
        ...(identity.referencedAgent?.capabilityPolicy?.toolIds ?? []),
        ...strings(source.config.toolIds),
        ...identity.skills.flatMap(skill => skill.tools.map(tool => tool.toolId)),
        ...source.capabilities,
    ]);
}

function resolveExecutionConfig(
    config: Record<string, unknown>,
    agent: ExecutorConfig | undefined,
    context: BindingContext,
): Record<string, unknown> {
    const defaults = context.flowDefaults;
    const result = { ...defaults, ...config };
    delete result.model;
    delete result.prompt;
    return {
        ...result,
        instruction: stringValue(config.instruction),
        ...resolveModelSettings(config, agent, context),
        ...resolveHarnessSettings(config, agent, context),
    };
}

function resolveModelSettings(
    config: Record<string, unknown>,
    agent: ExecutorConfig | undefined,
    context: BindingContext,
): Record<string, unknown> {
    const defaults = context.flowDefaults;
    return {
        connectionId: stringValue(config.connectionId) ?? agent?.connectionId
            ?? stringValue(defaults.connectionId) ?? context.setup.config.connectionId,
        modelName: stringValue(config.modelName) ?? agent?.model
            ?? stringValue(defaults.modelName) ?? context.setup.config.model,
        temperature: numberValue(config.temperature) ?? agent?.temperature
            ?? numberValue(defaults.temperature) ?? context.setup.config.temperature,
        maxTokens: numberValue(config.maxTokens) ?? agent?.constraints?.maxTokens
            ?? numberValue(defaults.maxTokens) ?? context.setup.config.constraints?.maxTokens,
        timeoutMs: numberValue(config.timeoutMs) ?? agent?.constraints?.timeout
            ?? numberValue(defaults.timeoutMs) ?? context.setup.config.constraints?.timeout,
        thinking: booleanValue(config.thinking) ?? agent?.enableThinking
            ?? booleanValue(defaults.thinking) ?? context.setup.config.enableThinking,
        reasoningEffort: reasoningValue(config.reasoningEffort) ?? agent?.reasoningEffort
            ?? reasoningValue(defaults.reasoningEffort) ?? context.setup.config.reasoningEffort,
    };
}

function resolveHarnessSettings(
    config: Record<string, unknown>,
    agent: ExecutorConfig | undefined,
    context: BindingContext,
): Record<string, unknown> {
    const defaults = context.flowDefaults;
    return {
        stream: booleanValue(config.stream) ?? agent?.stream
            ?? booleanValue(defaults.stream) ?? context.setup.config.stream,
        webSearch: booleanValue(config.webSearch)
            ?? webSearchValue(agent)
            ?? booleanValue(defaults.webSearch)
            ?? webSearchValue(context.setup.config),
    };
}

async function resolveDelegation(
    parent: AgentSource,
    parentMessages: ChatMessage[],
    context: BindingContext,
    templateDepth: number,
): Promise<Record<string, unknown> | undefined> {
    const delegation = record(parent.config.delegation);
    if (delegation.enabled !== true) return undefined;
    if (templateDepth >= DELEGATION_LIMITS.maxDepth) {
        throw new Error(`Delegation template nesting exceeds ${DELEGATION_LIMITS.maxDepth}`);
    }
    const template = record(delegation.template);
    const contextSource = delegationContextSource(template.contextSource);
    const child = await bindAgentSource(childSource(parent, template, contextSource), context, templateDepth + 1);
    const resolvedConfig = record(child.config);
    applyDelegationContext(resolvedConfig, parentMessages, template, contextSource);
    return {
        ...delegation,
        resolvedTemplate: {
            plugin: 'builtin.agent',
            pluginVersion: '1.0.0',
            config: resolvedConfig,
            capabilities: child.capabilities,
        },
    };
}

function childSource(
    parent: AgentSource,
    template: Record<string, unknown>,
    contextSource: 'session' | 'parent' | 'upstream' | 'isolated',
): AgentSource {
    return {
        id: `${parent.id}:template`,
        name: `${parent.name} child`,
        config: {
            ...normalizeLegacyFields(template),
            historyPolicy: contextSource === 'session' ? 'inherit' : contextSource === 'upstream' ? 'upstream' : 'none',
        },
        capabilities: [],
    };
}

function applyDelegationContext(
    child: Record<string, unknown>,
    parentMessages: ChatMessage[],
    template: Record<string, unknown>,
    source: 'session' | 'parent' | 'upstream' | 'isolated',
): void {
    const messages = Array.isArray(child.messages) ? child.messages.filter(isChatMessage) : [];
    const childSystem = messages.filter(message => message.role === 'system');
    if (source === 'parent') {
        const parentBody = parentMessages.filter(message => message.role !== 'system'
            && (template.includeToolResults === true || message.role !== 'tool'));
        child.messages = [
            ...(template.includeParentSystemPrompt !== false ? parentMessages.filter(message => message.role === 'system') : []),
            ...childSystem,
            ...parentBody,
        ];
    } else if (source === 'upstream' || source === 'isolated') {
        child.messages = childSystem;
    }
    child.includeDependencyOutputs = template.includeToolResults
        ?? (source === 'parent' || source === 'upstream');
}

function historyPolicy(config: Record<string, unknown>, defaults: Record<string, unknown>) {
    const value = config.historyPolicy ?? defaults.historyPolicy;
    return value === 'none' || value === 'upstream' ? value : 'inherit';
}

function systemPromptPolicy(config: Record<string, unknown>, defaults: Record<string, unknown>) {
    const value = config.systemPromptPolicy ?? defaults.systemPromptPolicy;
    return value === 'replace' || value === 'none' ? value : 'inherit';
}

function delegationContextSource(value: unknown): 'session' | 'parent' | 'upstream' | 'isolated' {
    return value === 'session' || value === 'parent' || value === 'upstream' || value === 'isolated'
        ? value
        : 'isolated';
}

function taskInstruction(config: Record<string, unknown>): string[] {
    const value = stringValue(config.instruction);
    return value ? [value] : [];
}

function isChatMessage(value: unknown): value is ChatMessage {
    return Boolean(value) && typeof value === 'object' && typeof (value as { role?: unknown }).role === 'string';
}

function reasoningValue(value: unknown): 'low' | 'medium' | 'high' | 'xhigh' | undefined {
    return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh' ? value : undefined;
}

function webSearchValue(config: ExecutorConfig | undefined): boolean | undefined {
    return config?.webSearchMode === undefined ? undefined : config.webSearchMode === 'builtin';
}

function strings(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : [];
}

function unique(values: string[]): string[] { return [...new Set(values)]; }
function stringValue(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value : undefined; }
function numberValue(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined; }
function booleanValue(value: unknown): boolean | undefined { return typeof value === 'boolean' ? value : undefined; }
function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Normalize deprecated field aliases once at the binding boundary. */
function normalizeLegacyFields(config: Record<string, unknown>): Record<string, unknown> {
    const instruction = stringValue(config.instruction) ?? stringValue(config.prompt);
    const modelName = stringValue(config.modelName) ?? stringValue(config.model);
    return {
        ...config,
        ...(instruction ? { instruction } : {}),
        ...(modelName ? { modelName } : {}),
    };
}
