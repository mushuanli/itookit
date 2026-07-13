// @file: llm-engine/src/mission/mission-service.ts
// Public facade for Mission Orchestration.
//
// Responsibilities:
//   - Create missions: run multi-angle planning → generate MissionPlan → persist
//   - Run scheduling loop via MissionScheduler
//   - Cancel / query missions

import type {
    IVFSManager,
    ISubAgentRouter,
    IAgentLookup,
    IHITLQueue,
    MissionPlan,
    MissionConfig,
    MissionPaths,
    TodoItem,
    SubAgentTask,
} from '@itookit/common';
import { generateUUID } from '@itookit/common';
import { TodoStateManager } from './todo-state';
import { ResultPersistenceService } from './result-persister';
import { MissionScheduler } from './mission-scheduler';
import { LiteSubAgentRouter } from './lite-sub-agent-router';
import type { LLMKernelAdapter } from '../adapters/llmkernel-adapter';
import type { IToolExecutor } from '../session/agent-loop-strategy';

export interface MissionServiceOptions {
    vfs: IVFSManager;
    /** ISubAgentRouter (from harness or LiteSubAgentRouter). Auto-created if not provided. */
    router?: ISubAgentRouter;
    agentLookup: IAgentLookup;
    hitlQueue?: IHITLQueue;
    /** Required if router is not provided — used to auto-create LiteSubAgentRouter */
    kernelAdapter?: LLMKernelAdapter;
    /** Optional — used by LiteSubAgentRouter for tool execution */
    toolExecutor?: IToolExecutor;
}

const PLANNER_SYSTEM_PROMPT = `You are a mission planner. Given a goal and context, decompose it into concrete tasks.

Respond with a JSON array of TodoItem objects (no markdown):
[
  {
    "title": "Short title",
    "description": "Detailed instructions for the executor agent",
    "agentRole": "researcher | coder | reviewer | writer | analyst",
    "dependsOn": [],
    "canParallel": true,
    "priority": 5,
    "retryCount": 0,
    "maxRetries": 2
  }
]

Rules:
- Each task must be independently executable by a single agent
- Set dependsOn to IDs of tasks that must complete first (use array index as temp ID)
- canParallel: true if this task can run alongside other tasks with no shared state
- priority: 1-10 (higher = scheduled first among ready tasks)
- Keep tasks atomic — prefer more smaller tasks over fewer large ones`;

export class MissionService {
    private readonly todoState: TodoStateManager;
    private readonly resultPersistence: ResultPersistenceService;
    private readonly router: ISubAgentRouter;
    private readonly agentLookup: IAgentLookup;
    private readonly hitlQueue?: IHITLQueue;
    private readonly activeControllers = new Map<string, AbortController>();

    constructor(opts: MissionServiceOptions) {
        this.todoState = new TodoStateManager(opts.vfs);
        this.resultPersistence = new ResultPersistenceService(opts.vfs);
        this.router = opts.router ?? (() => {
            if (!opts.kernelAdapter) {
                throw new Error('MissionService: either router or kernelAdapter must be provided');
            }
            return new LiteSubAgentRouter(opts.kernelAdapter, opts.toolExecutor);
        })();
        this.agentLookup = opts.agentLookup;
        this.hitlQueue = opts.hitlQueue;
    }

    async init(): Promise<void> {
        await this.todoState.init();
        await this.resultPersistence.init();
    }

    // ── Public API ────────────────────────────────────────────

    /**
     * Create a mission plan via parallel planners, then run the scheduling loop.
     * Returns the missionId immediately; execution continues in background.
     */
    async createAndRun(goal: string, context: string, config: MissionConfig): Promise<string> {
        const missionId = generateUUID();
        const paths = buildPaths(missionId);

        // Phase 1: Multi-angle planning
        const todos = await this.runPlanners(goal, context, config);

        const plan: MissionPlan = {
            id: missionId,
            goal,
            context,
            status: 'executing',
            todos,
            config,
            paths,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };

        await this.todoState.createMission(plan);
        await this.todoState.appendJournal(missionId, `Mission created: ${goal}`);

        // Phase 2: Start scheduling loop (non-blocking)
        const controller = new AbortController();
        this.activeControllers.set(missionId, controller);

        const scheduler = new MissionScheduler({
            todoState: this.todoState,
            router: this.router,
            resultPersistence: this.resultPersistence,
            agentLookup: this.agentLookup,
            hitlQueue: this.hitlQueue,
        });

        scheduler.run(missionId, controller.signal)
            .then(async () => {
                const finalPlan = await this.todoState.getPlan(missionId);
                const allDone = finalPlan?.todos.every(t => t.status === 'done');
                await this.todoState.updateMissionStatus(missionId, allDone ? 'done' : 'failed');
                await this.todoState.appendJournal(missionId, `Mission ${allDone ? '✓ completed' : '✗ failed'}`);
            })
            .catch(async (err: unknown) => {
                const msg = err instanceof Error ? err.message : String(err);
                await this.todoState.updateMissionStatus(missionId, 'failed');
                await this.todoState.appendJournal(missionId, `Mission failed: ${msg}`);
            })
            .finally(() => this.activeControllers.delete(missionId));

        return missionId;
    }

    async getMission(missionId: string): Promise<MissionPlan | null> {
        return this.todoState.getPlan(missionId);
    }

    async cancelMission(missionId: string): Promise<void> {
        this.activeControllers.get(missionId)?.abort();
        this.activeControllers.delete(missionId);
        this.hitlQueue?.abortAll('Mission cancelled');
        await this.todoState.updateMissionStatus(missionId, 'cancelled');
        await this.todoState.appendJournal(missionId, 'Mission cancelled by user');
    }

    // ── Planning phase ────────────────────────────────────────

    private async runPlanners(
        goal: string,
        context: string,
        config: MissionConfig,
    ): Promise<TodoItem[]> {
        if (config.plannerAgentIds.length === 0) {
            return this.runSinglePlanner(goal, context, config, 'general');
        }

        // Run each planner in parallel (different perspectives)
        const plannerRuns = config.plannerAgentIds.map(agentId =>
            this.runSinglePlanner(goal, context, config, agentId),
        );
        const allTodoLists = await Promise.all(plannerRuns);

        // Merge: union of all todos, deduplicate by title similarity
        return mergeTodos(allTodoLists.flat());
    }

    private async runSinglePlanner(
        goal: string,
        context: string,
        config: MissionConfig,
        agentId: string,
    ): Promise<TodoItem[]> {
        let systemPrompt = PLANNER_SYSTEM_PROMPT;
        let connectionId: string | undefined;
        let modelName: string | undefined;

        if (agentId !== 'general') {
            const def = await this.agentLookup.getAgentConfig(agentId);
            if (def) {
                systemPrompt = def.config.systemPrompt
                    ? `${def.config.systemPrompt}\n\n${PLANNER_SYSTEM_PROMPT}`
                    : PLANNER_SYSTEM_PROMPT;
                connectionId = def.config.connectionId;
                modelName    = def.config.modelName;
            }
        }

        const availableAgents = await this.describeAgentPool(config.agentPoolIds);

        const task: SubAgentTask = {
            instruction: [
                `Goal: ${goal}`,
                context ? `Context: ${context}` : '',
                '',
                `Available executor agents:\n${availableAgents}`,
                '',
                'Decompose this goal into tasks. Output JSON array only.',
            ].filter(Boolean).join('\n'),
            systemPrompt,
            connectionId,
            modelName,
            responseFormat: 'JSON array of TodoItem objects',
            maxTurns: 5,
            allowedTools: [],
        };

        const result = await this.router.delegate(task);
        return parseTodoList(result.summary, config);
    }

    private async describeAgentPool(agentPoolIds: string[]): Promise<string> {
        const lines: string[] = [];
        for (const id of agentPoolIds) {
            const def = await this.agentLookup.getAgentConfig(id);
            if (def) lines.push(`- ${def.name} (${id}): ${def.description ?? 'no description'}`);
        }
        return lines.join('\n') || '(generic executor)';
    }
}

// ── Helpers ────────────────────────────────────────────────────

function buildPaths(missionId: string): MissionPaths {
    return {
        planFile:    `/${missionId}/plan.json`,
        journalFile: `/${missionId}/journal.md`,
        resultsDir:  `/${missionId}/results`,
        summariesDir:`/${missionId}/summaries`,
        hitlDir:     `/${missionId}/hitl`,
    };
}

function parseTodoList(text: string, _config: MissionConfig): TodoItem[] {
    try {
        const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
        const raw: any[] = JSON.parse(cleaned);

        return raw.map((item, idx) => ({
            id: generateUUID(),
            title: item.title ?? `Task ${idx + 1}`,
            description: item.description ?? item.title ?? '',
            agentRole: item.agentRole ?? 'executor',
            agentId: item.agentId,
            // dependsOn uses raw indices → resolve to UUIDs handled post-merge
            dependsOn: [],
            canParallel: item.canParallel ?? true,
            priority: item.priority ?? 5,
            status: 'pending',
            retryCount: 0,
            maxRetries: item.maxRetries ?? 2,
        }));
    } catch {
        // Fallback: single generic task
        return [{
            id: generateUUID(),
            title: 'Execute goal',
            description: text,
            agentRole: 'executor',
            dependsOn: [],
            canParallel: false,
            priority: 5,
            status: 'pending',
            retryCount: 0,
            maxRetries: 2,
        }];
    }
}

function mergeTodos(todos: TodoItem[]): TodoItem[] {
    // Simple dedup by lowercased title
    const seen = new Map<string, TodoItem>();
    for (const todo of todos) {
        const key = todo.title.toLowerCase().trim();
        if (!seen.has(key)) seen.set(key, todo);
    }
    return Array.from(seen.values());
}
