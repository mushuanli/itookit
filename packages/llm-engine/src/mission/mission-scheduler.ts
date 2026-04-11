// @file: llm-engine/src/mission/mission-scheduler.ts
// Deterministic scheduling loop for Mission Orchestration.
//
// Responsibilities:
//   - Read plan.json → find ready todos → dispatch to sub-agent router
//   - After execution: write results → run verifier → update todo status
//   - Propagate skipped on failure; terminate when all todos are in terminal state

import type {
    ISubAgentRouter,
    SubAgentTask,
    IResultPersistenceService,
    IAgentLookup,
    IHITLQueue,
    MissionPlan,
    TodoItem,
    VerifierVerdict,
} from '@itookit/common';
import { generateUUID } from '@itookit/common';
import { TodoStateManager } from './todo-state';

const POLL_INTERVAL_MS = 500;

const VERIFIER_SYSTEM_PROMPT = `You are a task verifier. Review the executor's output and determine if the task is complete.

Respond with a JSON object (no markdown):
{
  "verdict": "done" | "retry" | "hitl",
  "feedback": "<required when retry: specific instructions for the executor>",
  "hitlContext": "<required when hitl: context for human decision>",
  "hitlQuestion": "<required when hitl: question for human>"
}

Rules:
- "done": task objective fully met
- "retry": result incomplete or incorrect — provide actionable feedback
- "hitl": ambiguous or requires human judgement — provide enough context`;

export interface MissionSchedulerOptions {
    todoState: TodoStateManager;
    router: ISubAgentRouter;
    resultPersistence: IResultPersistenceService;
    agentLookup: IAgentLookup;
    hitlQueue?: IHITLQueue;
}

export class MissionScheduler {
    private readonly todoState: TodoStateManager;
    private readonly router: ISubAgentRouter;
    private readonly resultPersistence: IResultPersistenceService;
    private readonly agentLookup: IAgentLookup;
    private readonly hitlQueue?: IHITLQueue;

    constructor(opts: MissionSchedulerOptions) {
        this.todoState = opts.todoState;
        this.router = opts.router;
        this.resultPersistence = opts.resultPersistence;
        this.agentLookup = opts.agentLookup;
        this.hitlQueue = opts.hitlQueue;
    }

    /**
     * Main scheduling loop. Runs until mission is complete, all todos are terminal,
     * or the signal is aborted.
     */
    async run(missionId: string, signal: AbortSignal): Promise<void> {
        while (!signal.aborted) {
            const plan = await this.todoState.getPlan(missionId);
            if (!plan) throw new Error(`Mission ${missionId} not found`);

            if (this.todoState.isComplete(plan)) break;

            const ready = this.todoState.getReadyTodos(plan);
            if (ready.length === 0) {
                // Wait for running/verifying/blocked todos to resolve
                await delay(POLL_INTERVAL_MS);
                continue;
            }

            // Mark todos as running atomically before dispatching
            await this.todoState.markTodosRunning(missionId, ready.map(t => t.id));

            // Execute all ready todos — parallel ones concurrently, serial ones sequentially
            const parallelTodos = ready.filter(t => t.canParallel);
            const serialTodos   = ready.filter(t => !t.canParallel);

            const parallelRuns = parallelTodos.map(todo =>
                this.executeTodo(todo, plan, signal).catch(err => {
                    console.error(`[MissionScheduler] Todo ${todo.id} failed:`, err);
                }),
            );

            // Serial todos run one by one
            const serialRun = (async () => {
                for (const todo of serialTodos) {
                    if (signal.aborted) break;
                    await this.executeTodo(todo, plan, signal).catch(err => {
                        console.error(`[MissionScheduler] Todo ${todo.id} failed:`, err);
                    });
                }
            })();

            await Promise.all([...parallelRuns, serialRun]);

            // After a batch, propagate skipped to todos whose deps failed
            await this.todoState.propagateSkipped(missionId);
        }
    }

    // ── Private ──────────────────────────────────────────────

    private async executeTodo(todo: TodoItem, plan: MissionPlan, signal: AbortSignal): Promise<void> {
        const missionId = plan.id;

        try {
            // Build sub-agent task with agent config + mission context
            const task = await this.buildTask(todo, plan);

            // Run executor agent
            const result = await this.router.delegate(task);

            if (signal.aborted) return;

            const summary = result.success ? result.summary : `[FAILED] ${result.error ?? result.summary}`;

            // Persist results
            const { resultPath, summaryPath } = await this.resultPersistence.saveResult(
                missionId, todo.id, result.summary, summary,
            );
            await this.resultPersistence.appendJournal(
                missionId,
                `[${todo.title}] Executor ${result.success ? 'done' : 'failed'} (${result.turns} turns)`,
            );

            // Update todo to verifying
            await this.todoState.updateTodo(missionId, todo.id, {
                status: 'verifying',
                resultPath,
                summaryPath,
            });

            // Run verifier
            await this.runVerifier(todo, plan, summary, signal);

        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            const newRetryCount = todo.retryCount + 1;
            const exhausted = newRetryCount > todo.maxRetries;
            await this.todoState.updateTodo(missionId, todo.id, {
                status: exhausted ? 'failed' : 'pending',
                retryCount: newRetryCount,
                feedback: `Execution error: ${msg}`,
            });
            await this.resultPersistence.appendJournal(
                missionId,
                `[${todo.title}] Execution error: ${msg}${exhausted ? ' — FAILED (max retries)' : ' — will retry'}`,
            );
        }
    }

    private async runVerifier(
        todo: TodoItem,
        plan: MissionPlan,
        executorSummary: string,
        signal: AbortSignal,
    ): Promise<void> {
        const missionId = plan.id;

        // Build verifier system prompt
        const verifierSystemPrompt = plan.config.verifierAgentId
            ? await this.getAgentSystemPrompt(plan.config.verifierAgentId) ?? VERIFIER_SYSTEM_PROMPT
            : VERIFIER_SYSTEM_PROMPT;

        const verifierInstruction = [
            `Task: ${todo.title}`,
            `Description: ${todo.description}`,
            '',
            `Executor output:`,
            executorSummary,
            '',
            `Evaluate whether this task is complete. Respond with JSON only.`,
        ].join('\n');

        const verifierTask: SubAgentTask = {
            instruction: verifierInstruction,
            systemPrompt: verifierSystemPrompt,
            connectionId: plan.config.verifierAgentId
                ? await this.getAgentConnectionId(plan.config.verifierAgentId)
                : undefined,
            responseFormat: 'JSON object with verdict, feedback, hitlContext, hitlQuestion fields',
            maxTurns: 3,
            allowedTools: [],
        };

        let verdict: VerifierVerdict = { verdict: 'done' };
        try {
            const verifierResult = await this.router.delegate(verifierTask);
            verdict = parseVerdict(verifierResult.summary);
        } catch {
            // If verifier fails, assume done to avoid infinite loop
        }

        if (signal.aborted) return;

        if (verdict.verdict === 'done') {
            await this.todoState.updateTodo(missionId, todo.id, { status: 'done' });
            await this.resultPersistence.appendJournal(missionId, `[${todo.title}] ✓ Verified done`);

        } else if (verdict.verdict === 'retry') {
            const newRetryCount = todo.retryCount + 1;
            const exhausted = newRetryCount > todo.maxRetries;
            await this.todoState.updateTodo(missionId, todo.id, {
                status: exhausted ? 'failed' : 'pending',
                retryCount: newRetryCount,
                feedback: verdict.feedback ?? 'Retry without specific feedback',
            });
            await this.resultPersistence.appendJournal(
                missionId,
                `[${todo.title}] Verifier: retry (${newRetryCount}/${todo.maxRetries})${exhausted ? ' — FAILED' : ''}`,
            );

        } else if (verdict.verdict === 'hitl' && this.hitlQueue) {
            const requestId = generateUUID();
            await this.todoState.updateTodo(missionId, todo.id, {
                status: 'blocked',
                hitlRequestId: requestId,
            });
            await this.resultPersistence.appendJournal(
                missionId,
                `[${todo.title}] Blocked — waiting for human input (${requestId})`,
            );

            // Push to queue — awaits human response
            const response = await this.hitlQueue.push({
                id: requestId,
                missionId,
                todoId: todo.id,
                context: verdict.hitlContext ?? executorSummary,
                question: verdict.hitlQuestion ?? 'Please review and provide guidance.',
                createdAt: Date.now(),
            });

            // Resume with human feedback
            await this.todoState.updateTodo(missionId, todo.id, {
                status: 'pending',
                hitlRequestId: undefined,
                feedback: `Human response: ${response}`,
            });
            await this.resultPersistence.appendJournal(
                missionId,
                `[${todo.title}] Human responded — resuming`,
            );
        } else {
            // hitl requested but no queue — treat as done
            await this.todoState.updateTodo(missionId, todo.id, { status: 'done' });
        }
    }

    private async buildTask(todo: TodoItem, plan: MissionPlan): Promise<SubAgentTask> {
        // Resolve agent definition if specified
        let systemPrompt: string | undefined;
        let connectionId: string | undefined;
        let modelName: string | undefined;

        const agentId = todo.agentId ?? this.pickAgentFromPool(todo, plan);
        if (agentId) {
            const agentDef = await this.agentLookup.getAgentConfig(agentId);
            if (agentDef) {
                systemPrompt = agentDef.config.systemPrompt;
                connectionId = agentDef.config.connectionId;
                modelName    = agentDef.config.modelName;
            }
        }

        // Build instruction with optional feedback
        const instruction = todo.feedback
            ? `${todo.description}\n\n---\nPrevious attempt feedback:\n${todo.feedback}`
            : todo.description;

        // Context files: journal + existing summaries
        const contextFiles = [plan.paths.journalFile];

        // Add summaries of completed deps
        for (const depId of todo.dependsOn) {
            const dep = plan.todos.find(t => t.id === depId);
            if (dep?.summaryPath) contextFiles.push(dep.summaryPath);
        }

        return {
            instruction: `Mission context: ${plan.goal}\n\nTask: ${instruction}`,
            systemPrompt,
            connectionId,
            modelName,
            contextFiles,
            allowedTools: ['file_read', 'glob_search', 'grep_search', 'file_write', 'write_result'],
            maxTurns: 20,
        };
    }

    private pickAgentFromPool(_todo: TodoItem, plan: MissionPlan): string | undefined {
        // Simple heuristic: pick first agent in pool (Swarm routing can enhance this later)
        return plan.config.agentPoolIds[0];
    }

    private async getAgentSystemPrompt(agentId: string): Promise<string | undefined> {
        const def = await this.agentLookup.getAgentConfig(agentId);
        return def?.config.systemPrompt;
    }

    private async getAgentConnectionId(agentId: string): Promise<string | undefined> {
        const def = await this.agentLookup.getAgentConfig(agentId);
        return def?.config.connectionId;
    }
}

// ── Helpers ───────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function parseVerdict(text: string): VerifierVerdict {
    try {
        const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
        const parsed = JSON.parse(cleaned);
        if (['done', 'retry', 'hitl'].includes(parsed.verdict)) {
            return parsed as VerifierVerdict;
        }
    } catch {
        // fall through
    }
    // Default: done (conservative — avoid infinite retry loops)
    return { verdict: 'done' };
}
