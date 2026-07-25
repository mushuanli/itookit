import type {
    AgentTaskConfig,
    HarnessAgentDefinition,
    TaskExecutionContext,
    TaskExecutor,
    TaskHandlerRef,
    TaskResult,
} from '@itookit/common';

export const HARNESS_AGENT_TASK_HANDLER: TaskHandlerRef = { kind: 'agent', provider: 'builtin', version: '1', schemaVersion: 1 };

export interface HarnessAgentTaskRuntime {
    resolveDefinition(id: string, version: string): Promise<HarnessAgentDefinition>;
    execute(definition: HarnessAgentDefinition, context: TaskExecutionContext<AgentTaskConfig>): Promise<TaskResult>;
}

/** Harness-side adapter for the existing Loop preset; it contains no DAG scheduling. */
export class HarnessAgentTaskExecutor implements TaskExecutor<AgentTaskConfig> {
    readonly handler = HARNESS_AGENT_TASK_HANDLER;
    constructor(private readonly runtime: HarnessAgentTaskRuntime) {}

    async execute(context: TaskExecutionContext<AgentTaskConfig>): Promise<TaskResult> {
        const definition = await this.runtime.resolveDefinition(String(context.config.agent.id), context.config.agent.version);
        if (definition.id !== context.config.agent.id || definition.version !== context.config.agent.version) {
            throw new Error(`AgentDefinition exact-version check failed for ${String(context.config.agent.id)}@${context.config.agent.version}`);
        }
        return this.runtime.execute(definition, context);
    }
}

