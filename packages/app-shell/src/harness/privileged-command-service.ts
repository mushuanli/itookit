import type { Harness, TaskHandle } from '@itookit/harness';
import { AgentResolver, type IAgentConfigService } from '@itookit/llm-session';
import type {
    ExecCommandRequest,
    IPrivilegedCommandService,
    PlanCommandRequest,
} from '@itookit/llm-ui';

export class PrivilegedCommandService implements IPrivilegedCommandService {
    private readonly agents: AgentResolver;

    constructor(
        private readonly harness: Harness,
        agentService: IAgentConfigService,
    ) {
        this.agents = new AgentResolver(agentService);
    }

    async plan(request: PlanCommandRequest): Promise<string> {
        const config = await this.agents.resolveForChat(request.agentId);
        if (!config.connectionId) throw new Error('Selected agent has no LLM connection');
        const session = await this.harness.openSession(request.sessionId);
        const task = await session.submit({
            program: { kind: 'llm.plan', version: '1' },
            input: {
                sessionId: request.sessionId,
                roundId: createRunId('plan'),
                connectionId: config.connectionId,
                model: config.model,
                temperature: config.temperature,
                thinking: config.enableThinking,
                reasoningEffort: config.reasoningEffort,
                goal: request.goal,
            },
            labels: { command: 'plan' },
            deferStart: true,
        });
        await bindCapability(task, 'llm', 'llm://plan', 'llmHandleId');
        return task.id;
    }

    async exec(request: ExecCommandRequest): Promise<string> {
        const session = await this.harness.openSession(request.sessionId);
        const task = await session.submit({
            program: { kind: 'coreutils.exec', version: '1' },
            input: { command: request.command },
            labels: { command: 'exec' },
            deferStart: true,
        });
        await bindCapability(task, 'process', 'process://exec', 'processHandleId');
        return task.id;
    }
}

async function bindCapability(
    task: TaskHandle,
    kind: string,
    uri: string,
    field: string,
): Promise<void> {
    const grant = await task.createResource({ kind, uri, rights: ['execute'] });
    await task.signal({ type: 'capabilities', payload: { [field]: grant.handle.id } });
    await task.start();
}

function createRunId(prefix: string): string {
    return `${prefix}-${crypto.randomUUID()}`;
}
