// @file: apps/cli/src/expand.ts
// 顶层 YAML 简写展开：把 model/env/prompt/needs/uses/result 简写展开为完整配置，
// 供 loadWorkflow 在 Zod 校验之前调用。完整写法（providers/connections/agents/tasks）
// 与简写写法可混用：简写生成 default 资源，用户显式定义的资源追加合并。

const PROVIDER_PRESETS: Record<string, { implementation: string; base_url: string }> = {
    anthropic: { implementation: 'anthropic', base_url: 'https://api.anthropic.com' },
    openai: { implementation: 'openai-compatible', base_url: 'https://api.openai.com/v1' },
    gemini: { implementation: 'gemini', base_url: 'https://generativelanguage.googleapis.com' },
};

/** 展开简写字段，返回新的配置对象（不改动入参）。 */
export function expandWorkflow(raw: unknown): unknown {
    if (!isRecord(raw)) return raw;
    const result: Record<string, unknown> = { ...raw };
    expandModel(result);
    if (Array.isArray(result.tasks)) result.tasks = result.tasks.map(expandTask);
    if (typeof result.result === 'string') result.result = { task: result.result, output: 'result' };
    return result;
}

function expandModel(result: Record<string, unknown>): void {
    if (result.model === undefined) return;
    const { providerId, modelId } = parseModel(result.model);
    const preset = PROVIDER_PRESETS[providerId.toLowerCase()] ?? {};
    const baseUrl = result.base_url ?? preset.base_url;
    const implementation = result.implementation ?? preset.implementation ?? 'openai-compatible';
    const apiKeyEnv = result.api_key_env ?? (isRecord(result.env) ? result.env.api_key : undefined);
    if (!baseUrl) {
        throw new Error(`model shorthand requires base_url or a known provider (${Object.keys(PROVIDER_PRESETS).join('|')})`);
    }
    if (!apiKeyEnv) throw new Error('model shorthand requires api_key_env or env.api_key');

    result.providers = [
        { id: 'default', implementation, base_url: baseUrl, api_key_env: apiKeyEnv, models: [{ id: modelId }] },
        ...(Array.isArray(result.providers) ? result.providers : []),
    ];
    result.connections = [
        { id: 'default', provider: 'default', tiers: { standard: modelId } },
        ...(Array.isArray(result.connections) ? result.connections : []),
    ];
    result.agents = [
        { id: 'default', connection: 'default' },
        ...(Array.isArray(result.agents) ? result.agents : []),
    ];
    delete result.model;
    delete result.base_url;
    delete result.implementation;
    delete result.api_key_env;
    delete result.env;
}

function expandTask(raw: unknown): unknown {
    if (!isRecord(raw)) return raw;
    const task: Record<string, unknown> = { ...raw };
    if (task.prompt !== undefined && task.description === undefined) task.description = task.prompt;
    delete task.prompt;
    if (task.needs !== undefined && task.depends_on === undefined) {
        task.depends_on = Array.isArray(task.needs) ? task.needs : [task.needs];
    }
    delete task.needs;
    if (task.uses !== undefined && task.agent === undefined) task.agent = task.uses;
    delete task.uses;
    // 控制节点（route/spawn/supervisor）不需要 agent 与 outputs 声明。
    const isControl = task.route !== undefined || task.spawn !== undefined || task.supervisor !== undefined;
    if (!isControl && task.agent === undefined) task.agent = 'default';
    if (!isControl && task.outputs === undefined) task.outputs = { result: 'text' };
    return task;
}

function parseModel(model: unknown): { providerId: string; modelId: string } {
    if (isRecord(model) && typeof model.provider === 'string' && typeof model.model === 'string') {
        return { providerId: model.provider, modelId: model.model };
    }
    if (typeof model === 'string') {
        const parts = model.split('/');
        if (parts.length === 2 && parts[0] && parts[1]) return { providerId: parts[0], modelId: parts[1] };
    }
    throw new Error('model must be "provider/model-id" or { provider, model }');
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
