// @file: llm-engine/src/mission/mission-scheduler.ts
// Deterministic scheduling loop for Mission Orchestration.
//
// S5: Replaced 500ms polling while(true) with DependencyScheduler + reconcile().
//     Verifier agent replaced by createLLMJudgePredicate.
//     Sub-agent execution wrapped in SubAgentLoopAdapter (ILoop).
//
// Responsibilities:
//   - Read plan.json → create Goal → reconcile(goal, loopFactory, predicate)
//   - DependencyScheduler replaces getReadyTodos() + propagateSkipped()
//   - llm-judge predicate replaces runVerifier()

import type {
    ISubAgentRouter,
    SubAgentTask,
    IResultPersistenceService,
    MissionPlan,
    ILLMService,
    ILoop,
    LoopContext,
    AgentRunSpec,
    ILog,
    Round,
    Ref,
    RefStore,
    DraftArea,
    AssemblyStrategy,
    ChatMessage,
    AgentEvent,
    Signal,
    IToolService,
} from '@itookit/common';
import { TodoStateManager } from './todo-state';
import { createMissionGoal } from './mission-goal-factory';
import { createSubAgentLoopAdapter } from './sub-agent-loop-adapter';
import { reconcile } from '../core/goal/reconciler';
import { createLLMJudgePredicate } from '../core/goal/predicates';

export interface MissionSchedulerOptions {
    todoState: TodoStateManager;
    router: ISubAgentRouter;
    resultPersistence: IResultPersistenceService;
    /** Required for llm-judge predicate (S5). */
    llmService: ILLMService;
    /** Connection ID for the verifier LLM. Defaults to first agent pool entry. */
    verifierConnectionId?: string;
}

export class MissionScheduler {
    private readonly todoState: TodoStateManager;
    private readonly router: ISubAgentRouter;
    private readonly resultPersistence: IResultPersistenceService;
    private readonly llmService: ILLMService;
    private readonly verifierConnectionId?: string;

    constructor(opts: MissionSchedulerOptions) {
        this.todoState = opts.todoState;
        this.router = opts.router;
        this.resultPersistence = opts.resultPersistence;
        this.llmService = opts.llmService;
        this.verifierConnectionId = opts.verifierConnectionId;
    }

    /**
     * Main scheduling loop using reconcile() (S5).
     *
     * Replaces the old while(true) + 500ms polling with event-driven
     * DependencyScheduler dispatch.
     */
    async run(missionId: string, signal: AbortSignal): Promise<void> {
        const plan = await this.todoState.getPlan(missionId);
        if (!plan) throw new Error(`Mission ${missionId} not found`);

        if (this.todoState.isComplete(plan)) return;

        // Convert plan to Goal
        const goal = createMissionGoal(plan);
        const verifierConnId = this.verifierConnectionId ?? plan.config.agentPoolIds[0] ?? 'default';

        // Build a minimal no-op ILog — Mission uses VFS persistence via
        // TodoStateManager, not the ILoop's Log append/fold mechanism.
        const noopLog: ILog = createNoopLog();

        // Build a minimal no-op IToolService — Mission sub-agents call
        // router.delegate() directly, not the ILoop tool execution path.
        const noopTools: IToolService = createNoopToolService();

        const predicate = createLLMJudgePredicate(this.llmService, verifierConnId);

        const loopFactory = (spec: AgentRunSpec): ILoop => {
            return createSubAgentLoopAdapter({
                router: this.router,
                buildTask: (_prompt, _context) => this.buildTaskForNode(spec, plan),
            });
        };

        const actorFactory = (_nodeId: string) => createNoopSessionActor();

        const baseCtx: Omit<LoopContext, 'ref'> = {
            sessionId: missionId,
            log: noopLog,
            llm: this.llmService,
            tools: noopTools,
            middlewares: [],
            signal,
        };

        // Run reconcile — event-driven, no polling
        await reconcile(goal, loopFactory, predicate, actorFactory, baseCtx, {
            maxConcurrent: plan.config.maxParallelAgents,
        });

        // Update plan status to reflect completion
        await this.todoState.updateMissionStatus(missionId, 'done');
        await this.resultPersistence.appendJournal(missionId, 'Mission completed via reconcile()');
    }

    // ── Task building (preserved from original) ────────────────

    private buildTaskForNode(spec: AgentRunSpec, plan: MissionPlan): SubAgentTask {
        const todo = plan.todos.find(t => t.id === spec.id);
        if (!todo) {
            return {
                instruction: spec.prompt,
                maxRounds: 20,
                allowedTools: [],
            };
        }

        // Build instruction with any feedback from context
        const feedback = todo.feedback;
        const instruction = feedback
            ? `${todo.description}\n\n---\nPrevious attempt feedback:\n${feedback}`
            : todo.description;

        const contextFiles = [plan.paths.journalFile];
        for (const depId of todo.dependsOn) {
            const dep = plan.todos.find(t => t.id === depId);
            if (dep?.summaryPath) contextFiles.push(dep.summaryPath);
        }

        return {
            instruction: `Mission context: ${plan.goal}\n\nTask: ${instruction}`,
            contextFiles,
            allowedTools: ['file_read', 'glob_search', 'grep_search', 'file_write', 'write_result'],
            maxRounds: 20,
        };
    }
}

// ── No-op stubs for reconcile() compatibility ─────────────────────────

function createNoopLog(): ILog {
    return {
        async append(_ref: Ref, _round: Round): Promise<string> { return ''; },
        async fold(_ref: Ref, _strategy?: AssemblyStrategy): Promise<ChatMessage[]> { return []; },
        refs(): RefStore {
            return {
                create: () => '',
                move: () => {},
                tag: () => {},
                delete: () => {},
                list: () => [],
            };
        },
        draft(): DraftArea {
            return {
                checkpoint: async () => {},
                flush: async () => {},
                current: () => null,
                restore: async () => null,
                setCurrent: () => {},
            };
        },
        async merge(): Promise<string> { return ''; },
        async rebase(): Promise<string> { return ''; },
    };
}

function createNoopToolService(): IToolService {
    return {
        getToolMeta: () => undefined,
        invoke: async () => ({ success: false, output: 'no-op tool service' }),
        listTools: () => [],
        register: () => {},
    } as unknown as IToolService;
}

function createNoopSessionActor(): { emit(event: AgentEvent): void; waitSignal(): Promise<Signal> } {
    return {
        emit: () => {},
        waitSignal: async () => ({ type: 'abort' }),
    };
}
