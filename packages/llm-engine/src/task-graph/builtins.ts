import type {
    JsonValue,
    RouteTaskConfig,
    TaskExecutor,
    TaskResult,
    TaskExecutionContext,
    TaskHandlerRef,
    TaskEdgeId,
    SerializableExpression,
} from '@itookit/common';
import { asRecord } from './utils';
import { TaskExecutorRegistry } from './registry';

const handler = (kind: 'agent' | 'route' | 'transform' | 'reduce' | 'human' | 'subflow' | 'spawn'): TaskHandlerRef => ({
    kind, provider: 'builtin', version: '1', schemaVersion: 1,
});

export const BUILTIN_HANDLERS = {
    agent: handler('agent'), route: handler('route'), transform: handler('transform'), reduce: handler('reduce'), human: handler('human'), subflow: handler('subflow'), spawn: handler('spawn'),
};

export class DeterministicRouteExecutor implements TaskExecutor<RouteTaskConfig> {
    readonly handler = BUILTIN_HANDLERS.route;
    async execute(context: TaskExecutionContext<RouteTaskConfig>): Promise<TaskResult> {
        const rules = [...context.config.rules].sort((a, b) => a.priority - b.priority || String(a.edgeId).localeCompare(String(b.edgeId)));
        const activated: string[] = [];
        for (const rule of rules) {
            const input = rule.condition.source.kind === 'status'
                ? { status: 'succeeded' }
                : await this.findArtifactValue(context, rule.condition.source.outputName);
            if (evaluateExpression(rule.condition.expression, input)) {
                activated.push(String(rule.edgeId));
                if (context.config.mode === 'exclusive' || context.config.mode === 'fallback') break;
            }
        }
        if (!activated.length && context.config.defaultEdgeId) activated.push(String(context.config.defaultEdgeId));
        if (context.config.mode === 'exclusive' && activated.length > 1) activated.splice(1);
        const allEdges = rules.map(rule => String(rule.edgeId));
        return { artifacts: [], effects: [{ kind: 'route', decision: { activatedEdgeIds: activated as TaskEdgeId[], skippedEdgeIds: allEdges.filter(id => !activated.includes(id)) as TaskEdgeId[], reason: 'deterministic route' } }] };
    }

    private async findArtifactValue(context: TaskExecutionContext<RouteTaskConfig>, outputName: string): Promise<unknown> {
        for (const id of context.inputs.flatMap(port => port.artifacts)) {
            const artifact = await context.services.artifacts.get(id as never);
            if (artifact?.outputName === outputName || !outputName) return artifact?.content;
        }
        return undefined;
    }
}

interface TransformConfig { outputName?: string; type?: 'text' | 'json' | 'summary' | 'final-answer'; value?: JsonValue; operation?: 'identity' | 'pick'; path?: string[] }

export class TransformExecutor implements TaskExecutor<TransformConfig> {
    readonly handler = BUILTIN_HANDLERS.transform;
    async execute(context: TaskExecutionContext<TransformConfig>): Promise<TaskResult> {
        let value: JsonValue = context.config.value ?? context.inputs.flatMap(input => input.bindings).find(binding => binding.kind === 'text')?.content ?? '';
        if (context.config.operation === 'pick' && context.config.path) {
            let current: unknown = value;
            for (const part of context.config.path) current = asRecord(current)[part];
            value = (current ?? null) as JsonValue;
        }
        return { artifacts: [{ outputName: context.config.outputName ?? 'result', type: context.config.type ?? 'json', content: value }] };
    }
}

interface ReduceConfig { outputName?: string; type?: 'text' | 'json' | 'summary' | 'final-answer'; separator?: string }

export class ReduceExecutor implements TaskExecutor<ReduceConfig> {
    readonly handler = BUILTIN_HANDLERS.reduce;
    async execute(context: TaskExecutionContext<ReduceConfig>): Promise<TaskResult> {
        const values: unknown[] = [];
        for (const port of context.inputs) for (const id of port.artifacts) {
            const artifact = await context.services.artifacts.get(id as never);
            if (artifact) values.push(artifact.content);
        }
        const content: JsonValue = context.config.type === 'text'
            ? values.map(String).join(context.config.separator ?? '\n')
            : values as JsonValue;
        return { artifacts: [{ outputName: context.config.outputName ?? 'result', type: context.config.type ?? 'json', content }] };
    }
}

interface HumanConfig { requestId?: string; prompt: string; schema?: { id: string; version?: string } }
export class HumanTaskExecutor implements TaskExecutor<HumanConfig> {
    readonly handler = BUILTIN_HANDLERS.human;
    async execute(context: TaskExecutionContext<HumanConfig>): Promise<TaskResult> {
        const response = context.inputs.flatMap(input => input.bindings).find(binding => binding.kind === 'text' && binding.label === 'human-response');
        if (response?.kind === 'text') return { artifacts: [{ outputName: 'response', type: 'json', content: response.content }] };
        return { artifacts: [], effects: [{ kind: 'await-human', request: { requestId: context.config.requestId ?? String(context.taskRunId), prompt: context.config.prompt, schema: context.config.schema } }] };
    }
}

interface SpawnConfig { plan: import('@itookit/common').SpawnPlan }
export class SpawnPlanExecutor implements TaskExecutor<SpawnConfig> {
    readonly handler = BUILTIN_HANDLERS.spawn;
    async execute(context: TaskExecutionContext<SpawnConfig>): Promise<TaskResult> {
        return { artifacts: [], effects: [{ kind: 'spawn', plan: { ...context.config.plan, parentTaskRunId: context.taskRunId } }] };
    }
}

export class SubflowExecutor extends SpawnPlanExecutor {
    readonly handler = BUILTIN_HANDLERS.subflow;
}

export function createBuiltinTaskExecutorRegistry(agentExecutor?: TaskExecutor): import('./registry').TaskExecutorRegistry {
    const registry = new TaskExecutorRegistry();
    registry.register(new DeterministicRouteExecutor());
    registry.register(new TransformExecutor());
    registry.register(new ReduceExecutor());
    registry.register(new HumanTaskExecutor());
    registry.register(new SpawnPlanExecutor());
    registry.register(new SubflowExecutor());
    if (agentExecutor) registry.register(agentExecutor);
    return registry;
}

function evaluateExpression(expression: SerializableExpression, value: unknown): boolean {
    switch (expression.kind) {
        case 'literal': return value === expression.value;
        case 'exists': return resolveExpression(expression.args![0], value) !== undefined;
        case 'not': return !evaluateExpression(expression.args![0], value);
        case 'and': return (expression.args ?? []).every(arg => evaluateExpression(arg, value));
        case 'or': return (expression.args ?? []).some(arg => evaluateExpression(arg, value));
        case 'eq': return resolveExpression(expression.args![0], value) === resolveExpression(expression.args![1], value);
        case 'neq': return resolveExpression(expression.args![0], value) !== resolveExpression(expression.args![1], value);
        case 'in': { const candidate = resolveExpression(expression.args?.[0] ?? { kind: 'literal', value: value as JsonValue }, value); return Array.isArray(expression.value) && expression.value.some(item => item === candidate); }
        case 'path': return resolveExpression(expression, value) !== undefined;
    }
}

function resolveExpression(expression: SerializableExpression, value: unknown): unknown {
    if (expression.kind === 'literal') return expression.value;
    if (expression.kind === 'path') { let current: unknown = value; for (const part of expression.path ?? []) current = asRecord(current)[part]; return current; }
    return evaluateExpression(expression, value);
}
