import type {
    AgentId,
    AgentTaskConfig,
    HarnessAgentDefinition,
    TaskExecutionContext,
    TaskExecutor,
    TaskHandlerRef,
    TaskResult,
} from '@itookit/common';
import { digest } from './utils';

export const AGENT_TASK_HANDLER: TaskHandlerRef = { kind: 'agent', provider: 'builtin', version: '1', schemaVersion: 1 };

/** Versioned immutable definition registry used by AgentTask startup. */
export class AgentDefinitionRegistry {
    private readonly definitions = new Map<string, HarnessAgentDefinition>();

    register(definition: HarnessAgentDefinition): HarnessAgentDefinition {
        const key = `${String(definition.id)}@${definition.version}`;
        const existing = this.definitions.get(key);
        if (existing) {
            if (digest(existing) !== digest(definition)) throw new Error(`AgentDefinition ${key} is immutable`);
            return structuredClone(existing);
        }
        this.definitions.set(key, structuredClone(definition));
        return structuredClone(definition);
    }

    resolve(id: AgentId, version: string): HarnessAgentDefinition {
        const definition = this.definitions.get(`${String(id)}@${version}`);
        if (!definition) throw new Error(`AgentDefinition version not found: ${String(id)}@${version}`);
        return structuredClone(definition);
    }

    has(id: AgentId, version: string): boolean { return this.definitions.has(`${String(id)}@${version}`); }
    list(): HarnessAgentDefinition[] { return [...this.definitions.values()].map(definition => structuredClone(definition)); }
}

export interface AgentTaskExecutorOptions {
    definitions: AgentDefinitionRegistry;
    executeAgent?: (definition: HarnessAgentDefinition, context: TaskExecutionContext<AgentTaskConfig>) => Promise<TaskResult>;
}

/** Adapter boundary between TaskGraph and the harness loop; no DAG logic lives here. */
export class AgentTaskExecutor implements TaskExecutor<AgentTaskConfig> {
    readonly handler = AGENT_TASK_HANDLER;
    constructor(private readonly options: AgentTaskExecutorOptions) {}

    async execute(context: TaskExecutionContext<AgentTaskConfig>): Promise<TaskResult> {
        const definition = this.options.definitions.resolve(context.config.agent.id, context.config.agent.version);
        if (!this.options.executeAgent) throw new Error(`No AgentTask runtime configured for ${String(definition.id)}@${definition.version}`);
        return this.options.executeAgent(definition, context);
    }
}

