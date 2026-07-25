import type {
    JsonValue,
    TaskKindDescriptor,
    TaskKind,
} from '@itookit/common';
import { BUILTIN_HANDLERS } from './builtins';

const input = (name = 'input') => ({
    name, cardinality: 'many' as const, required: false, order: 0,
});
const output = (name = 'result') => ({ name, required: true, order: 0 });
const objectSchema = (
    properties: Record<string, JsonValue>,
    required: string[] = [],
): JsonValue => ({ type: 'object', properties, required });

function descriptor(
    kind: TaskKind,
    displayName: string,
    description: string,
    icon: string,
    configSchema: JsonValue,
    defaultConfig: JsonValue,
    ports: { input?: ReturnType<typeof input>[]; output?: ReturnType<typeof output>[] } = {},
): TaskKindDescriptor {
    return {
        handler: BUILTIN_HANDLERS[kind as keyof typeof BUILTIN_HANDLERS],
        displayName,
        description,
        icon,
        configSchema,
        defaultConfig,
        defaultInputPorts: ports.input ?? [input()],
        defaultOutputPorts: ports.output ?? [output()],
        defaultJoinPolicy: { kind: 'all-success' },
        defaultRetryPolicy: {
            maxAttempts: 1,
            backoff: { kind: 'none' },
        },
        defaultResourcePolicy: { sideEffect: 'none' },
    };
}

const expressionSchema = objectSchema({
    kind: { type: 'string', enum: ['literal', 'path', 'not', 'and', 'or', 'eq', 'neq', 'in', 'exists'] },
    value: {},
    path: { type: 'array', items: { type: 'string' } },
    args: { type: 'array', items: { type: 'object' } },
}, ['kind']);

const handlerSchema = objectSchema({
    kind: { type: 'string' },
    provider: { type: 'string' },
    version: { type: 'string' },
    schemaVersion: { type: 'integer' },
}, ['kind', 'provider', 'version', 'schemaVersion']);

export const BUILTIN_TASK_KIND_DESCRIPTORS: TaskKindDescriptor[] = [
    descriptor(
        'agent', 'Agent', 'Run a versioned agent with explicit context and state policies.', '🤖',
        objectSchema({
            agent: objectSchema({ id: { type: 'string' }, version: { type: 'string' } }, ['id', 'version']),
            prompt: { type: 'string' },
            contextPolicy: objectSchema({ mode: { type: 'string', enum: ['isolated', 'branch', 'selected', 'continuation'] } }, ['mode']),
            statePolicy: objectSchema({ mode: { type: 'string', enum: ['stateless', 'read-snapshot', 'fork', 'compare-and-swap', 'exclusive-update'] } }, ['mode']),
            loopMode: { type: 'string', enum: ['chat', 'loop', 'harness'] },
        }, ['agent', 'prompt', 'contextPolicy', 'statePolicy', 'loopMode']),
        {
            agent: { id: 'default', version: '1' },
            prompt: '',
            contextPolicy: { mode: 'branch' },
            statePolicy: { mode: 'stateless' },
            loopMode: 'chat',
        },
        { output: [output('final')] },
    ),
    descriptor(
        'route', 'Route', 'Activate outgoing control edges from deterministic rules.', '⑂',
        objectSchema({
            mode: { type: 'string', enum: ['exclusive', 'multicast', 'fallback'] },
            rules: {
                type: 'array',
                items: objectSchema({
                    edgeId: { type: 'string' },
                    condition: objectSchema({
                        source: objectSchema({ kind: { type: 'string', enum: ['status', 'artifact'] }, outputName: { type: 'string' } }, ['kind']),
                        expression: expressionSchema,
                    }, ['source', 'expression']),
                    priority: { type: 'integer' },
                }, ['edgeId', 'condition', 'priority']),
            },
            defaultEdgeId: { type: 'string' },
        }, ['mode', 'rules']),
        { mode: 'fallback', rules: [] },
        { output: [] },
    ),
    descriptor(
        'transform', 'Transform', 'Create or project a single artifact.', '↝',
        objectSchema({
            operation: { type: 'string', enum: ['identity', 'pick'] },
            value: {},
            path: { type: 'array', items: { type: 'string' } },
            outputName: { type: 'string' },
            type: { type: 'string', enum: ['text', 'json', 'summary', 'final-answer'] },
        }, ['operation', 'outputName', 'type']),
        { operation: 'identity', value: null, path: [], outputName: 'result', type: 'json' },
    ),
    descriptor(
        'reduce', 'Reduce', 'Combine multiple input artifacts into one output.', 'Σ',
        objectSchema({
            outputName: { type: 'string' },
            type: { type: 'string', enum: ['text', 'json', 'summary', 'final-answer'] },
            separator: { type: 'string' },
        }, ['outputName', 'type']),
        { outputName: 'result', type: 'text', separator: '\n' },
    ),
    descriptor(
        'human', 'Human', 'Pause until a matching human response is supplied.', '☝',
        objectSchema({
            requestId: { type: 'string' },
            prompt: { type: 'string' },
            schema: objectSchema({ id: { type: 'string' }, version: { type: 'string' } }, ['id']),
        }, ['requestId', 'prompt']),
        { requestId: 'approval', prompt: 'Please review and respond.' },
        { output: [output('response')] },
    ),
    descriptor(
        'subflow', 'Subflow', 'Execute a recursively described child flow plan.', '◇',
        objectSchema({
            spawnKey: { type: 'string' },
            children: { type: 'array', items: objectSchema({ key: { type: 'string' }, handler: handlerSchema, config: {}, inputs: { type: 'array' } }, ['key', 'handler', 'config', 'inputs']) },
            continuation: objectSchema({ key: { type: 'string' }, handler: handlerSchema, config: {}, inputs: { type: 'array' } }, ['key', 'handler', 'config', 'inputs']),
        }, ['spawnKey', 'children']),
        { spawnKey: 'subflow', children: [] },
    ),
    descriptor(
        'spawn', 'Spawn', 'Expand the graph with dynamic children and an optional continuation.', '✣',
        objectSchema({
            spawnKey: { type: 'string' },
            children: { type: 'array', items: objectSchema({ key: { type: 'string' }, handler: handlerSchema, config: {}, inputs: { type: 'array' } }, ['key', 'handler', 'config', 'inputs']) },
            continuation: objectSchema({ key: { type: 'string' }, handler: handlerSchema, config: {}, inputs: { type: 'array' } }, ['key', 'handler', 'config', 'inputs']),
        }, ['spawnKey', 'children']),
        { spawnKey: 'spawn', children: [] },
    ),
];

