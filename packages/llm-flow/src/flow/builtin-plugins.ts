import type {
    DagNodeContext,
    DagPlugin,
    DagPluginManifest,
    JsonValue,
} from '@itookit/common';
import { DELEGATION_DEFAULTS } from '@itookit/common';
import { buildLlmTaskInput, type LlmTaskInputOptions } from '@itookit/llm-tasks';
import { delegationSchema } from './delegation-schema';
import { DagPluginRegistry } from './plugin-registry';

export function createBuiltinDagPluginRegistry(): DagPluginRegistry {
    const registry = new DagPluginRegistry();
    for (const plugin of builtinPlugins()) registry.register(plugin);
    return registry;
}

function builtinPlugins(): DagPlugin[] {
    return [
        valuePlugin('builtin.transform', transformManifest(), 'transform'),
        valuePlugin('builtin.reduce', reduceManifest(), 'reduce'),
        valuePlugin('builtin.route', routeManifest(), 'route'),
        valuePlugin('builtin.spawn', spawnManifest(), 'spawn'),
        humanPlugin(),
        agentPlugin(),
    ];
}

function valuePlugin(
    id: string,
    descriptor: DagPluginManifest,
    operation: 'transform' | 'reduce' | 'route' | 'spawn',
): DagPlugin {
    const manifest = { ...descriptor, id };
    return {
        manifest,
        runtime: async () => ({
            createTask: context => ({
                programKind: 'flow.value',
                programVersion: '1',
                input: {
                    operation,
                    config: jsonRecord(context.config),
                    inputs: jsonRecord(context.inputs),
                    dependencies: context.dependencies,
                },
            }),
        }),
        ui: async () => defaultUI(manifest),
    };
}

function humanPlugin(): DagPlugin {
    const manifest = humanManifest();
    return {
        manifest,
        runtime: async () => ({
            createTask: context => {
                const config = record(context.config);
                return {
                    programKind: 'flow.human',
                    programVersion: '1',
                    input: {
                        requestId: string(config.requestId, context.nodeRunId),
                        prompt: string(config.prompt, 'Please provide input.'),
                        schema: jsonValue(config.schema),
                        dependencies: context.dependencies,
                    },
                };
            },
        }),
        ui: async () => defaultUI(manifest),
    };
}

function agentPlugin(): DagPlugin {
    const manifest = agentManifest();
    return {
        manifest,
        runtime: async () => ({ createTask: context => agentTask(context) }),
        ui: async () => defaultUI(manifest),
    };
}

function agentTask(context: DagNodeContext) {
    const config = record(context.config);
    const prompt = string(config.instruction, string(config.prompt, inputText(context.inputs)));
    const messages = Array.isArray(config.messages)
        ? config.messages
        : [{ role: 'user', content: prompt }];
    const delegation = record(config.delegation);
    const hasDelegation = isRecord(config.delegation);
    const subtasks = record(config.subtasks);
    return {
        programKind: 'llm.agent',
        programVersion: '1',
        input: buildLlmTaskInput({
            sessionId: string(config.sessionId, context.sessionId),
            roundId: string(config.roundId, context.nodeRunId),
            messages,
            connectionId: string(config.connectionId, 'default'),
            model: optionalString(config.modelName) ?? optionalString(config.model),
            temperature: optionalNumber(config.temperature),
            maxTokens: optionalNumber(config.maxTokens),
            timeoutMs: optionalNumber(config.timeoutMs),
            thinking: config.thinking === true,
            reasoningEffort: optionalReasoning(config.reasoningEffort),
            stream: optionalBoolean(config.stream),
            webSearch: optionalBoolean(config.webSearch),
            maxExchanges: optionalNumber(config.maxExchanges),
            workingDirectory: optionalString(config.workingDirectory),
            approval: optionalApproval(config.approval) ?? 'external',
            subtaskTool: hasDelegation
                ? delegation.enabled === true
                    ? optionalString(delegation.toolName) ?? DELEGATION_DEFAULTS.toolName
                    : undefined
                : optionalString(subtasks.tool),
            // This belongs to the current node. Child context policy is resolved
            // into the child template by the session binder.
            includeDependencyOutputs: optionalBoolean(config.includeDependencyOutputs),
            dependencyBindings: context.dependencies,
        }),
    };
}

function transformManifest(): DagPluginManifest {
    return manifest('transform', 'Transform', 'Data', {
        operation: enumSchema(['identity', 'pick']), value: {},
        path: { type: 'array', items: { type: 'string' } },
        outputName: { type: 'string' }, type: enumSchema(['text', 'json']),
    }, { operation: 'identity', outputName: 'result', type: 'json' });
}

function reduceManifest(): DagPluginManifest {
    return manifest('reduce', 'Reduce', 'Data', {
        outputName: { type: 'string' }, type: enumSchema(['text', 'json']), separator: { type: 'string' },
    }, { outputName: 'result', type: 'text', separator: '\n' });
}

function routeManifest(): DagPluginManifest {
    return manifest('route', 'Route', 'Control', {
        mode: enumSchema(['exclusive', 'multicast', 'fallback']),
        rules: { type: 'array', items: { type: 'object' } }, defaultEdgeId: { type: 'string' },
    }, { mode: 'fallback', rules: [] });
}

function spawnManifest(): DagPluginManifest {
    return manifest('spawn', 'Spawn', 'Control', {
        value: {}, outputName: { type: 'string' }, type: enumSchema(['text', 'json']),
        spawn: {
            type: 'object', title: 'Static graph patch', description: 'Deterministically add the declared nodes and edges. History belongs to spawned Agent nodes, not this control node.',
            properties: {
                idempotencyKey: { type: 'string', title: 'Idempotency key' },
                nodes: { type: 'array', title: 'Node templates', items: { type: 'object' } },
                edges: { type: 'array', title: 'Template connections', items: { type: 'object' } },
            },
        },
    }, { outputName: 'result', type: 'text', spawn: {} });
}

function humanManifest(): DagPluginManifest {
    return manifest('human', 'Human Input', 'Execution', {
        requestId: { type: 'string' }, prompt: { type: 'string' }, schema: {},
    }, { requestId: 'approval', prompt: 'Please review and respond.' });
}

function agentManifest(): DagPluginManifest {
    return manifest('agent', 'Agent', 'Execution', {
        // References to configuration entities (edit once, applies everywhere)
        agentId: { type: 'string' }, systemPromptId: { type: 'string' },
        connectionId: { type: 'string' },
        toolIds: { type: 'array', items: { type: 'string' } },
        skillIds: { type: 'array', items: { type: 'string' } },
        // Inline task instruction + model
        instruction: { type: 'string' }, systemPrompt: { type: 'array', items: { type: 'string' } }, modelName: { type: 'string' },
        temperature: { type: 'number' }, maxTokens: { type: 'integer' },
        thinking: { type: 'boolean' }, reasoningEffort: enumSchema(['low', 'medium', 'high', 'xhigh']),
        stream: { type: 'boolean' }, webSearch: { type: 'boolean' },
        // Execution policy
        maxExchanges: { type: 'integer' },
        timeoutMs: { type: 'integer' },
        approval: enumSchema(['none', 'external', 'all']),
        historyPolicy: enumSchema(['inherit', 'none', 'upstream']),
        systemPromptPolicy: enumSchema(['inherit', 'replace', 'none']),
        persistOutput: { type: 'boolean' },
        workingDirectory: { type: 'string' },
        delegation: delegationSchema(),
        subtasks: { type: 'object', title: 'Legacy subtasks JSON', description: 'Backward compatibility only; migrate to Delegation.' },
    // Inheritable values stay absent. Runtime fallbacks supply default connection,
    // approval and history only after Flow/Agent layers have had a chance to apply.
    }, {});
}

function manifest(
    kind: string,
    title: string,
    category: string,
    properties: Record<string, JsonValue>,
    defaultConfig: Record<string, JsonValue>,
): DagPluginManifest {
    return {
        id: `builtin.${kind}`, version: '1.0.0', kind, title, category,
        configSchema: {
            type: 'object',
            // Loop bound shared by every node kind: any node on a cycle may carry
            // maxIterations to cap re-entry (see DurableFlowExecutor.loopMaxIterations).
            properties: { ...properties, maxIterations: { type: 'integer' } },
        },
        defaultConfig,
        inputs: [{ name: 'input', cardinality: 'many', required: false, order: 0 }],
        outputs: [{ name: 'result', required: false, order: 0 }],
    };
}

function defaultUI(manifest: DagPluginManifest) {
    return {
        palette: { label: manifest.title, group: manifest.category },
        node: { summarize: (config: unknown) => JSON.stringify(config) },
        inspector: manifest.id === 'builtin.agent' ? {
            layout: {
                sections: [
                    { id: 'identity', title: 'Identity & task', fields: ['agentId', 'systemPromptId', 'systemPromptPolicy', 'instruction', 'systemPrompt'] },
                    { id: 'model', title: 'Model', fields: ['connectionId', 'modelName', 'temperature', 'maxTokens', 'thinking', 'reasoningEffort', 'stream', 'webSearch'] },
                    { id: 'capabilities', title: 'Capabilities', fields: ['toolIds', 'skillIds'] },
                    { id: 'context', title: 'Context & output', fields: ['historyPolicy', 'persistOutput'] },
                    { id: 'execution', title: 'Execution', fields: ['approval', 'maxExchanges', 'timeoutMs', 'maxIterations', 'workingDirectory', 'delegation', 'subtasks'] },
                ],
            },
        } : {},
    };
}

function enumSchema(values: string[]): Record<string, JsonValue> { return { type: 'string', enum: values }; }
function inputText(inputs: Record<string, unknown>): string {
    return Object.values(inputs).map(value => JSON.stringify(value)).join('\n');
}
function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function string(value: unknown, fallback: string): string { return typeof value === 'string' ? value : fallback; }
function optionalString(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }
function optionalNumber(value: unknown): number | undefined { return typeof value === 'number' ? value : undefined; }
function optionalBoolean(value: unknown): boolean | undefined { return typeof value === 'boolean' ? value : undefined; }
function optionalReasoning(value: unknown): LlmTaskInputOptions['reasoningEffort'] {
    return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh' ? value : undefined;
}
function optionalApproval(value: unknown): LlmTaskInputOptions['approval'] {
    return value === 'none' || value === 'external' || value === 'all' ? value : undefined;
}
function jsonValue(value: unknown): JsonValue { return JSON.parse(JSON.stringify(value ?? null)) as JsonValue; }
function jsonRecord(value: unknown): Record<string, JsonValue> { return jsonValue(record(value)) as Record<string, JsonValue>; }
