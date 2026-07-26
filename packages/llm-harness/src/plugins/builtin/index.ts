import type {
    DagNodeContext,
    DagPlugin,
    DagPluginManifest,
    JsonValue,
} from '@itookit/common';
import { DagPluginRegistry } from '../dag-plugin-registry';
import {
    graphPatchOutcome,
    reduceOutcome,
    routeOutcome,
    transformOutcome,
} from './dag-operations';
import { DagHumanProgram, DagValueProgram } from './dag-programs';

export function registerBuiltinDagPlugins(registry: DagPluginRegistry): void {
    for (const plugin of builtinPlugins()) registry.register(plugin);
}

export function builtinDagPrograms() {
    return [new DagValueProgram(), new DagHumanProgram()];
}

function builtinPlugins(): DagPlugin[] {
    return [
        valuePlugin('builtin.transform', transformManifest(), transformOutcome),
        valuePlugin('builtin.reduce', reduceManifest(), reduceOutcome),
        valuePlugin('builtin.route', routeManifest(), routeOutcome),
        valuePlugin('builtin.spawn', patchManifest('spawn', 'Spawn'), config => graphPatchOutcome(config)),
        valuePlugin('builtin.subflow', patchManifest('subflow', 'Subflow'), config => graphPatchOutcome(config)),
        humanPlugin(),
        agentPlugin(),
    ];
}

function valuePlugin(
    id: string,
    manifest: DagPluginManifest,
    create: (config: Record<string, unknown>, inputs: Record<string, unknown>) =>
        import('@itookit/common').DagNodeOutcome,
): DagPlugin {
    return {
        manifest: { ...manifest, id },
        runtime: async () => ({
            createProcess: context => ({
                programKind: 'dag.value',
                input: { outcome: create(record(context.config), context.inputs) },
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
            createProcess: context => {
                const config = record(context.config);
                return {
                    programKind: 'dag.human',
                    input: {
                        requestId: string(config.requestId, context.nodeRunId),
                        prompt: string(config.prompt, 'Please provide input.'),
                        schema: config.schema,
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
        runtime: async () => ({
            createProcess: context => agentProcess(context),
            mapOutput: agentOutcome,
        }),
        ui: async () => defaultUI(manifest),
    };
}

function agentOutcome(output: unknown): import('@itookit/common').DagNodeOutcome {
    const result = record(output);
    const message = record(result.message);
    return {
        outputs: {
            result: {
                outputName: 'result',
                type: 'final-answer',
                content: message.content === undefined ? '' : message.content as never,
            },
        },
    };
}

function agentProcess(context: DagNodeContext): import('@itookit/common').DirectRunSpec {
    const config = record(context.config);
    const prompt = string(config.prompt, inputText(context.inputs));
    const messages = Array.isArray(config.messages)
        ? config.messages
        : [{ role: 'user', content: prompt }];
    return {
        programKind: 'llm.agent',
        input: {
            sessionId: string(config.sessionId, context.runId),
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
        },
        capabilities: Array.isArray(config.toolIds) ? config.toolIds.map(String) : [],
    };
}

function transformManifest(): DagPluginManifest {
    return manifest('transform', 'Transform', 'Data', {
        operation: enumSchema(['identity', 'pick']),
        value: {},
        path: { type: 'array', items: { type: 'string' } },
        outputName: { type: 'string' },
        type: enumSchema(['text', 'json', 'summary', 'final-answer']),
    }, { operation: 'identity', outputName: 'result', type: 'json' });
}

function reduceManifest(): DagPluginManifest {
    return manifest('reduce', 'Reduce', 'Data', {
        outputName: { type: 'string' },
        type: enumSchema(['text', 'json', 'summary', 'final-answer']),
        separator: { type: 'string' },
    }, { outputName: 'result', type: 'text', separator: '\n' });
}

function routeManifest(): DagPluginManifest {
    return manifest('route', 'Route', 'Control', {
        mode: enumSchema(['exclusive', 'multicast', 'fallback']),
        rules: { type: 'array', items: { type: 'object' } },
        defaultEdgeId: { type: 'string' },
    }, { mode: 'fallback', rules: [] });
}

function humanManifest(): DagPluginManifest {
    return manifest('human', 'Human Input', 'Execution', {
        requestId: { type: 'string' },
        prompt: { type: 'string' },
        schema: {},
    }, { requestId: 'approval', prompt: 'Please review and respond.' });
}

function agentManifest(): DagPluginManifest {
    return {
        ...manifest('agent', 'Agent', 'Execution', {
            prompt: { type: 'string' },
            connectionId: { type: 'string' },
            model: { type: 'string' },
            toolIds: { type: 'array', items: { type: 'string' } },
            maxExchanges: { type: 'integer' },
            approval: enumSchema(['none', 'external', 'all']),
        }, { prompt: '', connectionId: 'default', toolIds: [], approval: 'external' }),
        requiredCapabilities: [],
    };
}

function patchManifest(kind: string, title: string): DagPluginManifest {
    return manifest(kind, title, 'Composition', {
        idempotencyKey: { type: 'string' },
        nodes: { type: 'array', items: { type: 'object' } },
        edges: { type: 'array', items: { type: 'object' } },
    }, { idempotencyKey: '', nodes: [], edges: [] });
}

function manifest(
    kind: string,
    title: string,
    category: string,
    properties: Record<string, JsonValue>,
    defaultConfig: Record<string, JsonValue>,
): DagPluginManifest {
    return {
        id: `builtin.${kind}`,
        version: '1.0.0',
        kind,
        title,
        category,
        configSchema: { type: 'object', properties },
        defaultConfig,
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

function enumSchema(values: string[]): JsonValue {
    return { type: 'string', enum: values };
}

function inputText(inputs: Record<string, unknown>): string {
    return Object.values(inputs).map(value => JSON.stringify(value)).join('\n');
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function string(value: unknown, fallback: string): string {
    return typeof value === 'string' ? value : fallback;
}

function optionalString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
    return typeof value === 'number' ? value : undefined;
}
