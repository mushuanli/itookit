import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';
import { findCycles } from '@itookit/llm-flow';
import type { CompiledWorkflow, RouteCondition, WorkflowConfigV1 } from './types';

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
    if (agent.temperature !== undefined
        && (!Number.isFinite(agent.temperature) || agent.temperature < 0)) {
        errors.push(`agents.${agent.id}.temperature must be a non-negative number`);
    }
    if (agent.max_tokens !== undefined
        && (!Number.isInteger(agent.max_tokens) || agent.max_tokens < 1)) {
        errors.push(`agents.${agent.id}.max_tokens must be a positive integer`);
    }
    if (agent.reasoning_effort !== undefined && !['low', 'medium', 'xhigh'].includes(agent.reasoning_effort)) {
        errors.push(`agents.${agent.id}.reasoning_effort must be low, medium or xhigh`);
    }
    if (agent.approval !== undefined && !['none', 'external', 'all'].includes(agent.approval)) {
        errors.push(`agents.${agent.id}.approval must be none, external or all`);
    }
}

function validateTask(task: WorkflowConfigV1['tasks'][number], errors: string[]): void {
    if (task.route !== undefined) {
        validateRouteStructure(task, errors);
        validateCommonTaskFields(task, errors);
        return;
    }
    requiredString(task.description, `tasks.${task.id}.description`, errors);
    validateCommonTaskFields(task, errors);
    if (task.workspace_access && !['read', 'write'].includes(task.workspace_access)) {
        errors.push(`tasks.${task.id}.workspace_access must be read or write`);
    }
    if (task.outputs && Object.values(task.outputs).some(type => !['text', 'json', 'file'].includes(type))) {
        errors.push(`tasks.${task.id}.outputs contains an invalid type`);
    }
}

function validateCommonTaskFields(task: WorkflowConfigV1['tasks'][number], errors: string[]): void {
    parseDuration(task.timeout, `tasks.${task.id}.timeout`, errors);
    if (task.priority !== undefined && (!Number.isInteger(task.priority) || task.priority < 0)) {
        errors.push(`tasks.${task.id}.priority must be a non-negative integer`);
    }
    if (task.max_iterations !== undefined
        && (!Number.isInteger(task.max_iterations) || task.max_iterations < 1)) {
        errors.push(`tasks.${task.id}.max_iterations must be a positive integer`);
    }
    validateSpawn(task, errors);
    validateSupervisor(task, errors);
    validateBudget(task, errors);
    validateRetry(task, errors);
}

function validateSupervisor(task: WorkflowConfigV1['tasks'][number], errors: string[]): void {
    if (task.supervisor === undefined) return;
    const sup = task.supervisor;
    if (!Array.isArray(sup.workers) || !sup.workers.length) {
        errors.push(`tasks.${task.id}.supervisor.workers must be a non-empty array`);
    }
    if (sup.max_rounds !== undefined && (!Number.isInteger(sup.max_rounds) || sup.max_rounds < 1)) {
        errors.push(`tasks.${task.id}.supervisor.max_rounds must be a positive integer`);
    }
}

function validateSpawn(task: WorkflowConfigV1['tasks'][number], errors: string[]): void {
    if (task.spawn === undefined) return;
    const spawn = task.spawn;
    if (!Array.isArray(spawn.tasks) || !spawn.tasks.length) {
        errors.push(`tasks.${task.id}.spawn.tasks must be a non-empty array`);
    }
    for (const [index, subTask] of (spawn.tasks ?? []).entries()) {
        if (!subTask.id || !subTask.agent) {
            errors.push(`tasks.${task.id}.spawn.tasks[${index}] requires id and agent`);
        }
    }
    for (const edge of spawn.edges ?? []) {
        if (!edge.from || !edge.to) {
            errors.push(`tasks.${task.id}.spawn.edges has an edge without from/to`);
        }
    }
}

function validateRouteStructure(task: WorkflowConfigV1['tasks'][number], errors: string[]): void {
    const route = task.route!;
    if (route.mode !== undefined && !['exclusive', 'multicast', 'fallback'].includes(route.mode)) {
        errors.push(`tasks.${task.id}.route.mode must be exclusive, multicast or fallback`);
    }
    if (!Array.isArray(route.rules) || !route.rules.length) {
        errors.push(`tasks.${task.id}.route.rules must be a non-empty array`);
        return;
    }
    for (const [index, rule] of route.rules.entries()) {
        validateRouteCondition(rule.when, `tasks.${task.id}.route.rules[${index}].when`, errors);
        if (typeof rule.then !== 'string' || !rule.then.trim()) {
            errors.push(`tasks.${task.id}.route.rules has a rule without then`);
        }
    }
    if (route.default !== undefined && (typeof route.default !== 'string' || !route.default.trim())) {
        errors.push(`tasks.${task.id}.route.default must be a non-empty string`);
    }
}

function validateRouteCondition(condition: RouteCondition, label: string, errors: string[]): void {
    if (typeof condition === 'string') {
        if (!condition.trim()) errors.push(`${label} must not be empty`);
        return;
    }
    if (!condition || typeof condition !== 'object' || Array.isArray(condition)) {
        errors.push(`${label} must be a string or a condition object`);
        return;
    }
    const keys = ['eq', 'neq', 'in', 'exists', 'and', 'or', 'not'].filter(key => key in condition);
    if (!keys.length) errors.push(`${label} has no condition operator`);
    for (const list of ['and', 'or'] as const) {
        const sub = condition[list];
        if (sub !== undefined && !Array.isArray(sub)) errors.push(`${label}.${list} must be an array`);
        else (sub ?? []).forEach((item, index) => validateRouteCondition(item, `${label}.${list}[${index}]`, errors));
    }
    if (condition.not !== undefined) validateRouteCondition(condition.not, `${label}.not`, errors);
}

function validateBudget(task: WorkflowConfigV1['tasks'][number], errors: string[]): void {
    if (task.budget === undefined) return;
    if (!task.budget || typeof task.budget !== 'object' || Array.isArray(task.budget)) {
        errors.push(`tasks.${task.id}.budget must be an object of positive limits`);
        return;
    }
    for (const [dimension, limit] of Object.entries(task.budget)) {
        if (!Number.isFinite(limit) || limit <= 0) {
            errors.push(`tasks.${task.id}.budget.${dimension} must be a positive number`);
        }
    }
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
        if (task.route !== undefined) {
            for (const rule of task.route.rules ?? []) {
                if (rule.then && !tasks.has(rule.then)) errors.push(`task ${task.id} route references unknown task ${rule.then}`);
            }
            if (task.route.default !== undefined && !tasks.has(task.route.default)) {
                errors.push(`task ${task.id} route default references unknown task ${task.route.default}`);
            }
        } else if (task.spawn !== undefined) {
            for (const subTask of task.spawn.tasks ?? []) {
                if (subTask.agent && !agents.has(subTask.agent)) {
                    errors.push(`task ${task.id} spawn references unknown agent ${subTask.agent}`);
                }
            }
            for (const edge of task.spawn.edges ?? []) {
                if (edge.from !== task.id && !tasks.has(edge.from)) {
                    errors.push(`task ${task.id} spawn edge references unknown task ${edge.from}`);
                }
                if (edge.to && !tasks.has(edge.to) && !task.spawn.tasks.some(sub => sub.id === edge.to)) {
                    errors.push(`task ${task.id} spawn edge references unknown task ${edge.to}`);
                }
            }
        } else if (!agents.has(task.agent ?? '')) {
            errors.push(`task ${task.id} references unknown agent ${task.agent}`);
        }
        if (task.compensate !== undefined && !tasks.has(task.compensate)) {
            errors.push(`task ${task.id} compensates unknown task ${task.compensate}`);
        }
        for (const worker of task.supervisor?.workers ?? []) {
            if (!tasks.has(worker)) errors.push(`task ${task.id} supervisor references unknown worker ${worker}`);
        }
        for (const dependency of task.depends_on ?? []) {
            const depId = typeof dependency === 'string' ? dependency : dependency.task;
            if (!tasks.has(depId)) errors.push(`task ${task.id} references unknown dependency ${depId}`);
            if (typeof dependency !== 'string' && dependency.on_failure !== undefined
                && !['fail', 'skip', 'continue'].includes(dependency.on_failure)) {
                errors.push(`task ${task.id} dependency ${depId} has invalid on_failure`);
            }
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
    const edges = new Map((config.tasks ?? []).map(task => [
        task.id,
        new Set((task.depends_on ?? []).map(dep => typeof dep === 'string' ? dep : dep.task)),
    ]));
    for (const task of config.tasks ?? []) {
        for (const value of Object.values(task.inputs ?? {})) {
            if (typeof value === 'string') {
                const match = TEMPLATE.exec(value);
                if (match) edges.get(task.id)?.add(match[1]);
            }
        }
    }
    const nodes = (config.tasks ?? []).map(task => ({ id: task.id }));
    const graphEdges = [...edges.entries()].flatMap(([taskId, deps]) =>
        [...deps].map(dep => ({ id: `${dep}->${taskId}`, from: dep, to: taskId })));
    if (findCycles(nodes, graphEdges).backEdges.size > 0) {
        errors.push('tasks contain a dependency cycle');
    }
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
