import type {
    DagNodeContext,
    DagPlugin,
    DagPluginManifest,
    JsonValue,
} from '@itookit/common';
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
        humanPlugin(),
        agentPlugin(),
    ];
}

function valuePlugin(
    id: string,
    descriptor: DagPluginManifest,
    operation: 'transform' | 'reduce' | 'route',
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
    const prompt = string(config.prompt, inputText(context.inputs));
    const messages = Array.isArray(config.messages)
        ? config.messages
        : [{ role: 'user', content: prompt }];
    return {
        programKind: 'llm.agent',
        programVersion: '1',
        input: compact({
            sessionId: string(config.sessionId, context.sessionId),
            roundId: string(config.roundId, context.nodeRunId),
            messages,
            connectionId: string(config.connectionId, 'default'),
            model: optionalString(config.model),
            temperature: optionalNumber(config.temperature),
            maxTokens: optionalNumber(config.maxTokens),
            thinking: config.thinking === true,
            reasoningEffort: config.reasoningEffort,
            maxExchanges: optionalNumber(config.maxExchanges),
            workingDirectory: optionalString(config.workingDirectory),
            approval: config.approval ?? 'external',
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

function humanManifest(): DagPluginManifest {
    return manifest('human', 'Human Input', 'Execution', {
        requestId: { type: 'string' }, prompt: { type: 'string' }, schema: {},
    }, { requestId: 'approval', prompt: 'Please review and respond.' });
}

function agentManifest(): DagPluginManifest {
    return manifest('agent', 'Agent', 'Execution', {
        prompt: { type: 'string' }, connectionId: { type: 'string' }, model: { type: 'string' },
        toolIds: { type: 'array', items: { type: 'string' } }, maxExchanges: { type: 'integer' },
        approval: enumSchema(['none', 'external', 'all']),
    }, { prompt: '', connectionId: 'default', toolIds: [], approval: 'external' });
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
        configSchema: { type: 'object', properties }, defaultConfig,
        inputs: [{ name: 'input', cardinality: 'many', required: false, order: 0 }],
        outputs: [{ name: 'result', required: false, order: 0 }],
    };
}

function defaultUI(manifest: DagPluginManifest) {
    return {
        palette: { label: manifest.title, group: manifest.category },
        node: { summarize: (config: unknown) => JSON.stringify(config) },
        inspector: {},
    };
}

function enumSchema(values: string[]): JsonValue { return { type: 'string', enum: values }; }
function inputText(inputs: Record<string, unknown>): string {
    return Object.values(inputs).map(value => JSON.stringify(value)).join('\n');
}
function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function string(value: unknown, fallback: string): string { return typeof value === 'string' ? value : fallback; }
function optionalString(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }
function optionalNumber(value: unknown): number | undefined { return typeof value === 'number' ? value : undefined; }
function compact(value: Record<string, unknown>): Record<string, unknown> {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}
function jsonValue(value: unknown): JsonValue { return JSON.parse(JSON.stringify(value ?? null)) as JsonValue; }
function jsonRecord(value: unknown): Record<string, JsonValue> { return jsonValue(record(value)) as Record<string, JsonValue>; }
