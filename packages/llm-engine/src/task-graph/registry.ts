import type {
    HarnessPluginContribution,
    JsonValue,
    TaskExecutor,
    TaskHandlerRef,
} from '@itookit/common';
import { handlerKey } from './validation';

export class TaskExecutorRegistry {
    private readonly executors = new Map<string, TaskExecutor>();

    register(executor: TaskExecutor): void {
        const key = handlerKey(executor.handler);
        if (this.executors.has(key)) throw new Error(`Task executor already registered: ${key}`);
        this.executors.set(key, executor);
    }

    resolve(handler: TaskHandlerRef): TaskExecutor {
        const key = handlerKey(handler);
        const executor = this.executors.get(key);
        if (!executor) throw new Error(`Task executor is not registered: ${key}`);
        return executor;
    }

    has(handler: TaskHandlerRef): boolean { return this.executors.has(handlerKey(handler)); }
    list(): TaskHandlerRef[] { return [...this.executors.values()].map(executor => executor.handler); }
    keys(): Set<string> { return new Set(this.executors.keys()); }
}

export class HarnessContributionRegistry {
    private activated = false;
    private readonly plugins = new Map<string, HarnessPluginContribution>();
    private readonly taskKinds = new Map<string, NonNullable<HarnessPluginContribution['taskKinds']>[number]>();
    readonly executors: TaskExecutorRegistry;

    constructor(executors = new TaskExecutorRegistry()) { this.executors = executors; }

    register(plugin: HarnessPluginContribution): void {
        if (this.activated) throw new Error('Harness contributions cannot be registered after activation');
        if (this.plugins.has(`${plugin.id}@${plugin.version}`)) throw new Error(`Plugin already registered: ${plugin.id}@${plugin.version}`);
        for (const contribution of plugin.taskKinds ?? []) {
            const key = handlerKey(contribution.handler);
            if (this.taskKinds.has(key)) throw new Error(`Task kind already registered: ${key}`);
            this.taskKinds.set(key, contribution);
            if (contribution.executor) this.executors.register(contribution.executor);
        }
        // Plugin contributions may contain trusted runtime functions. Keep the
        // serializable manifest/config portions as data, but do not structured-
        // clone functions (plugins are process-local by design).
        this.plugins.set(`${plugin.id}@${plugin.version}`, { ...plugin, taskKinds: [...(plugin.taskKinds ?? [])] });
    }

    activate(): void { this.activated = true; }
    isActive(): boolean { return this.activated; }
    listTaskKinds(): TaskHandlerRef[] { return [...this.taskKinds.values()].map(item => item.handler); }
    listTaskKindDescriptors(): import('@itookit/common').TaskKindDescriptor[] {
        return [...this.taskKinds.values()].map(item => ({
            handler: item.handler,
            displayName: item.displayName,
            description: item.description,
            icon: item.icon,
            configSchema: item.configSchema,
            defaultConfig: item.defaultConfig,
            defaultInputPorts: item.defaultInputPorts,
            defaultOutputPorts: item.defaultOutputPorts,
            defaultJoinPolicy: item.defaultJoinPolicy,
            defaultRetryPolicy: item.defaultRetryPolicy,
            defaultResourcePolicy: item.defaultResourcePolicy,
        }));
    }
    getTaskKind(handler: TaskHandlerRef): NonNullable<HarnessPluginContribution['taskKinds']>[number] | undefined { return this.taskKinds.get(handlerKey(handler)); }

    validateConfig(handler: TaskHandlerRef, config: JsonValue): string[] {
        const contribution = this.getTaskKind(handler);
        if (!contribution) return [];
        return [
            ...validateJsonSchema(contribution.configSchema, config),
            ...(contribution.validator?.(config) ?? []),
        ];
    }
}

/** Small dependency-free JSON Schema subset for persisted plugin configs. */
function validateJsonSchema(schema: JsonValue, value: JsonValue, path = '$'): string[] {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return [];
    const object = schema as Record<string, JsonValue>;
    const errors: string[] = [];
    const type = object.type;
    if (typeof type === 'string' && !matchesType(type, value)) errors.push(`${path} must be ${type}`);
    if (Array.isArray(object.enum) && !object.enum.some(candidate => JSON.stringify(candidate) === JSON.stringify(value))) errors.push(`${path} is not an allowed value`);
    if (Array.isArray(object.required) && isObject(value)) {
        for (const key of object.required) if (typeof key === 'string' && !(key in value)) errors.push(`${path}.${key} is required`);
    }
    if (isObject(value) && isObject(object.properties)) {
        for (const [key, childSchema] of Object.entries(object.properties)) {
            if (key in value) errors.push(...validateJsonSchema(childSchema, value[key], `${path}.${key}`));
        }
    }
    if (Array.isArray(value) && object.items) {
        for (let index = 0; index < value.length; index++) errors.push(...validateJsonSchema(object.items, value[index], `${path}[${index}]`));
    }
    return errors;
}

function isObject(value: JsonValue): value is { [key: string]: JsonValue } {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function matchesType(type: string, value: JsonValue): boolean {
    if (type === 'null') return value === null;
    if (type === 'array') return Array.isArray(value);
    if (type === 'object') return isObject(value);
    if (type === 'string') return typeof value === 'string';
    if (type === 'number' || type === 'integer') return typeof value === 'number' && Number.isFinite(value) && (type !== 'integer' || Number.isInteger(value));
    if (type === 'boolean') return typeof value === 'boolean';
    return true;
}
