import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import type { CompiledWorkflow, WorkflowConfigV1 } from './types';

const ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const TEMPLATE = /^\$\{tasks\.([^.}]+)\.outputs\.([^.}]+)\}$/;

export async function loadWorkflow(configPath: string, checkEnvironment = true): Promise<{
    workflow: CompiledWorkflow;
    source: string;
    hash: string;
}> {
    const absoluteConfig = path.resolve(configPath);
    const source = await readFile(absoluteConfig, 'utf8');
    const raw = parse(source) as unknown;
    const config = validateWorkflow(raw, checkEnvironment);
    const base = path.dirname(absoluteConfig);
    const workspaceRoot = path.resolve(base, config.workspace?.root ?? '.');
    const stateDir = path.resolve(workspaceRoot, config.workspace?.state_dir ?? '.mindos');
    if (!isInside(workspaceRoot, stateDir)) throw new Error('workspace.state_dir must be inside workspace.root');
    if (stateDir === workspaceRoot) throw new Error('workspace.state_dir cannot equal workspace.root');
    return {
        workflow: {
            config,
            workspaceRoot,
            stateDir,
            maxDurationMs: parseDuration(config.runtime?.max_duration),
        },
        source,
        hash: createHash('sha256').update(source).digest('hex'),
    };
}

export function validateWorkflow(value: unknown, checkEnvironment = true): WorkflowConfigV1 {
    const config = record(value, 'YAML root') as unknown as WorkflowConfigV1;
    const errors: string[] = [];
    if (config.version !== 1) errors.push('version must be 1');
    requiredString(config.name, 'name', errors);
    requiredString(config.goal, 'goal', errors);
    validateCollections(config, errors, checkEnvironment);
    validateReferences(config, errors);
    validateDag(config, errors);
    if (errors.length) throw new Error(errors.join('\n'));
    return config;
}

function validateCollections(config: WorkflowConfigV1, errors: string[], checkEnvironment: boolean): void {
    for (const key of ['providers', 'connections', 'agents', 'tasks'] as const) {
        if (!Array.isArray(config[key]) || config[key].length === 0) errors.push(`${key} must be a non-empty array`);
        else validateIds(config[key] as Array<{ id: string }>, key, errors);
    }
    for (const provider of config.providers ?? []) {
        validateProvider(provider, errors);
        if (checkEnvironment && provider.api_key_env && !process.env[provider.api_key_env]) {
            errors.push(`environment variable ${provider.api_key_env} is not set`);
        }
    }
    for (const agent of config.agents ?? []) validateAgent(agent, errors);
    for (const task of config.tasks ?? []) {
        validateTask(task, errors);
    }
    const concurrency = config.runtime?.max_concurrency;
    if (concurrency !== undefined && (!Number.isInteger(concurrency) || concurrency < 1)) {
        errors.push('runtime.max_concurrency must be a positive integer');
    }
    parseDuration(config.runtime?.max_duration, 'runtime.max_duration', errors);
}

function validateProvider(provider: WorkflowConfigV1['providers'][number], errors: string[]): void {
    requiredString(provider.base_url, `providers.${provider.id}.base_url`, errors);
    requiredString(provider.api_key_env, `providers.${provider.id}.api_key_env`, errors);
    if (!['openai-compatible', 'anthropic', 'gemini', 'custom'].includes(provider.implementation)) {
        errors.push(`provider ${provider.id} has invalid implementation`);
    }
    if (!Array.isArray(provider.models) || !provider.models.length) {
        errors.push(`provider ${provider.id} requires models`);
    } else {
        validateIds(provider.models, `providers.${provider.id}.models`, errors);
    }
}

function validateAgent(agent: WorkflowConfigV1['agents'][number], errors: string[]): void {
    requiredString(agent.connection, `agents.${agent.id}.connection`, errors);
    if (agent.tools !== undefined && !Array.isArray(agent.tools)) errors.push(`agents.${agent.id}.tools must be an array`);
    if (agent.max_exchanges !== undefined
        && (!Number.isInteger(agent.max_exchanges) || agent.max_exchanges < 1)) {
        errors.push(`agents.${agent.id}.max_exchanges must be a positive integer`);
    }
}

function validateTask(task: WorkflowConfigV1['tasks'][number], errors: string[]): void {
    requiredString(task.description, `tasks.${task.id}.description`, errors);
    if (task.workspace_access && !['read', 'write'].includes(task.workspace_access)) {
        errors.push(`tasks.${task.id}.workspace_access must be read or write`);
    }
    if (task.outputs && Object.values(task.outputs).some(type => !['text', 'json', 'file'].includes(type))) {
        errors.push(`tasks.${task.id}.outputs contains an invalid type`);
    }
    parseDuration(task.timeout, `tasks.${task.id}.timeout`, errors);
    validateRetry(task, errors);
}

function validateReferences(config: WorkflowConfigV1, errors: string[]): void {
    const providers = ids(config.providers);
    const connections = ids(config.connections);
    const agents = ids(config.agents);
    const tasks = ids(config.tasks);
    for (const connection of config.connections ?? []) {
        if (!providers.has(connection.provider)) errors.push(`connection ${connection.id} references unknown provider ${connection.provider}`);
        validateConnectionModels(config, connection.id, errors);
    }
    for (const agent of config.agents ?? []) {
        if (!connections.has(agent.connection)) errors.push(`agent ${agent.id} references unknown connection ${agent.connection}`);
    }
    for (const task of config.tasks ?? []) {
        if (!agents.has(task.agent)) errors.push(`task ${task.id} references unknown agent ${task.agent}`);
        for (const dependency of task.depends_on ?? []) {
            if (!tasks.has(dependency)) errors.push(`task ${task.id} references unknown dependency ${dependency}`);
        }
        for (const [input, value] of Object.entries(task.inputs ?? {})) {
            if (typeof value !== 'string' || !value.startsWith('${tasks.')) continue;
            const match = TEMPLATE.exec(value);
            if (!match) errors.push(`task ${task.id} input ${input} has an invalid task output template`);
            else if (!tasks.has(match[1])) errors.push(`task ${task.id} input ${input} references unknown task ${match[1]}`);
            else validateOutputReference(config, task.id, input, match[1], match[2], errors);
        }
    }
    if (!config.result || !tasks.has(config.result.task)) errors.push('result.task must reference a task');
    const resultTask = config.tasks?.find(task => task.id === config.result?.task);
    if (resultTask?.outputs && !(config.result.output in resultTask.outputs)) {
        errors.push(`result.output ${config.result.output} is not declared by task ${resultTask.id}`);
    }
}

function validateConnectionModels(config: WorkflowConfigV1, connectionId: string, errors: string[]): void {
    const connection = config.connections?.find(item => item.id === connectionId);
    if (!connection || !connection.tiers || typeof connection.tiers !== 'object') {
        errors.push(`connection ${connectionId} requires tiers`);
        return;
    }
    const provider = config.providers?.find(item => item.id === connection.provider);
    const models = new Set(provider?.models?.map(model => model.id) ?? []);
    for (const [tier, model] of Object.entries(connection.tiers)) {
        if (!['optimal', 'standard', 'fast'].includes(tier)) errors.push(`connection ${connectionId} has invalid tier ${tier}`);
        if (typeof model !== 'string' || !models.has(model)) {
            errors.push(`connection ${connectionId} tier ${tier} references unknown model ${String(model)}`);
        }
    }
}

function validateOutputReference(
    config: WorkflowConfigV1,
    taskId: string,
    input: string,
    sourceId: string,
    output: string,
    errors: string[],
): void {
    const source = config.tasks?.find(task => task.id === sourceId);
    if (source?.outputs && !(output in source.outputs)) {
        errors.push(`task ${taskId} input ${input} references undeclared output ${sourceId}.${output}`);
    }
}

function validateRetry(task: WorkflowConfigV1['tasks'][number], errors: string[]): void {
    if (!task.retry) return;
    if (!Number.isInteger(task.retry.max_attempts) || task.retry.max_attempts < 1) {
        errors.push(`tasks.${task.id}.retry.max_attempts must be a positive integer`);
    }
    if (task.retry.backoff_ms !== undefined
        && (!Number.isFinite(task.retry.backoff_ms) || task.retry.backoff_ms < 0)) {
        errors.push(`tasks.${task.id}.retry.backoff_ms must be a non-negative number`);
    }
}

function validateDag(config: WorkflowConfigV1, errors: string[]): void {
    const edges = new Map((config.tasks ?? []).map(task => [task.id, new Set(task.depends_on ?? [])]));
    for (const task of config.tasks ?? []) {
        for (const value of Object.values(task.inputs ?? {})) {
            if (typeof value === 'string') {
                const match = TEMPLATE.exec(value);
                if (match) edges.get(task.id)?.add(match[1]);
            }
        }
    }
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): boolean => {
        if (visiting.has(id)) return true;
        if (visited.has(id)) return false;
        visiting.add(id);
        for (const dep of edges.get(id) ?? []) if (visit(dep)) return true;
        visiting.delete(id);
        visited.add(id);
        return false;
    };
    if ([...edges.keys()].some(visit)) errors.push('tasks contain a dependency cycle');
}

function validateIds(items: Array<{ id: string }>, label: string, errors: string[]): void {
    const seen = new Set<string>();
    for (const item of items) {
        if (!ID.test(item?.id ?? '')) errors.push(`${label} contains an invalid id: ${String(item?.id)}`);
        else if (seen.has(item.id)) errors.push(`${label} contains duplicate id ${item.id}`);
        seen.add(item?.id);
    }
}

function requiredString(value: unknown, label: string, errors: string[]): void {
    if (typeof value !== 'string' || !value.trim()) errors.push(`${label} is required`);
}

function record(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
    return value as Record<string, unknown>;
}

function ids(items?: Array<{ id: string }>): Set<string> {
    return new Set((items ?? []).map(item => item.id));
}

function isInside(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function parseDuration(value: string | number | undefined, label = 'duration', errors?: string[]): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
    const match = typeof value === 'string' ? /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(value.trim()) : null;
    if (match) return Number(match[1]) * ({ ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[match[2]]!);
    errors?.push(`${label} must be a positive number of milliseconds or use ms/s/m/h`);
    if (!errors) throw new Error(`${label} is invalid`);
    return undefined;
}

export function taskOutputReference(value: unknown): { taskId: string; output: string } | undefined {
    if (typeof value !== 'string') return undefined;
    const match = TEMPLATE.exec(value);
    return match ? { taskId: match[1], output: match[2] } : undefined;
}
