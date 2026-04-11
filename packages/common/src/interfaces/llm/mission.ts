// @file: common/interfaces/llm/mission.ts
// Mission Orchestration 系统的核心数据结构与服务接口。
//
// 设计原则：LLM 负责意图（plan/execute/verify），确定性 Scheduler 负责调度。
// TodoList 是唯一共享状态（持久化到 VFS），Scheduler 读依赖图决定串/并行。

import type { AgentDefinition } from './agent';

// ── 模块常量 ─────────────────────────────────────────────────

/** VFS module name for all mission data */
export const MISSION_MODULE = 'missions';

// ── 状态类型 ─────────────────────────────────────────────────

export type MissionStatus =
    | 'planning'   // planner agents generating todo list
    | 'executing'  // scheduler loop running
    | 'done'
    | 'failed'
    | 'cancelled';

export type TodoStatus =
    | 'pending'    // waiting to be scheduled
    | 'running'    // executor agent in progress
    | 'verifying'  // verifier agent checking result
    | 'done'
    | 'failed'     // exceeded maxRetries
    | 'blocked'    // waiting for HITL response
    | 'skipped';   // upstream dependency failed

// ── 核心数据结构 ──────────────────────────────────────────────

/**
 * 单个任务项。Planner agent 生成，Scheduler 调度，Verifier 更新状态。
 */
export interface TodoItem {
    id: string;
    title: string;
    /** 给 Executor agent 的详细指令 */
    description: string;

    // Scheduling (set by Planner)
    /** Todo IDs that must be 'done' before this can run */
    dependsOn: string[];
    /** Whether this can run in parallel with other ready todos */
    canParallel: boolean;
    /** 1-10, higher = scheduled first among ready todos */
    priority: number;

    // Agent selection
    /** Semantic role hint, e.g. 'researcher' | 'coder' | 'reviewer' */
    agentRole: string;
    /** Specific AgentDefinition ID to use (optional; Scheduler picks from pool if absent) */
    agentId?: string;

    // State
    status: TodoStatus;
    retryCount: number;
    maxRetries: number;
    /** Verifier feedback for retry — injected into next executor run */
    feedback?: string;

    // Results (set after execution)
    resultPath?: string;   // VFS path: full content
    summaryPath?: string;  // VFS path: one-level summary

    // HITL
    hitlRequestId?: string;
}

/**
 * VFS 路径约定（由 MissionService 生成，存入 plan.json）。
 */
export interface MissionPaths {
    planFile: string;    // /{missionId}/plan.json
    journalFile: string; // /{missionId}/journal.md
    resultsDir: string;  // /{missionId}/results/
    summariesDir: string;// /{missionId}/summaries/
    hitlDir: string;     // /{missionId}/hitl/
}

/**
 * Mission 配置。
 */
export interface MissionConfig {
    /** Global concurrency cap for executor agents */
    maxParallelAgents: number;
    /** AgentDefinition IDs available for task execution */
    agentPoolIds: string[];
    /** AgentDefinition IDs to run in parallel for multi-angle planning */
    plannerAgentIds: string[];
    /** AgentDefinition ID for the verifier (uses generic prompt if absent) */
    verifierAgentId?: string;
    /** Abort the mission after this many ms */
    timeoutMs?: number;
}

/**
 * Top-level mission plan — the single source of truth stored in VFS as plan.json.
 */
export interface MissionPlan {
    id: string;
    goal: string;
    /** Background context injected into every agent's system prompt */
    context: string;
    status: MissionStatus;
    todos: TodoItem[];
    config: MissionConfig;
    paths: MissionPaths;
    createdAt: number;
    updatedAt: number;
}

// ── HITL ─────────────────────────────────────────────────────

/**
 * A Human-in-the-Loop request pushed to HITLQueue by the human_input tool.
 */
export interface HITLRequest {
    id: string;
    missionId: string;
    todoId: string;
    /** Full context shown to the human before the question */
    context: string;
    question: string;
    /** Optional choices (shown as quick-select options in UI) */
    options?: string[];
    /** VFS paths of relevant files for human to review */
    files?: string[];
    createdAt: number;
}

// ── 服务接口 ─────────────────────────────────────────────────

/**
 * Minimal agent lookup interface.
 * Implemented by VFSAgentService (llm-engine), injected into harness tools
 * to avoid a circular dependency between llm-harness and llm-engine.
 */
export interface IAgentLookup {
    getAgentConfig(agentId: string): Promise<AgentDefinition | null>;
}

/**
 * Result persistence service interface.
 * Implemented by ResultPersistenceService (llm-engine, VFS-backed),
 * injected into llm-harness write_result tool via closure.
 */
export interface IResultPersistenceService {
    /**
     * Persist executor output. Returns { resultPath, summaryPath }.
     */
    saveResult(
        missionId: string,
        todoId: string,
        fullContent: string,
        summary: string,
    ): Promise<{ resultPath: string; summaryPath: string }>;

    /** Append a timestamped one-liner to the mission journal. */
    appendJournal(missionId: string, entry: string): Promise<void>;
}

/**
 * HITLQueue interface — implemented in llm-harness, consumed via IHITLQueue in llm-engine.
 */
export interface IHITLQueue {
    push(request: HITLRequest): Promise<string>;
    resolve(requestId: string, response: string): void;
    on(listener: (request: HITLRequest) => void): () => void;
    abortAll(reason?: string): void;
}

/**
 * Verifier verdict — the structured JSON a verifier agent must output.
 */
export interface VerifierVerdict {
    verdict: 'done' | 'retry' | 'hitl';
    /** Feedback for the executor on retry (required when verdict='retry') */
    feedback?: string;
    /** Context for the human on HITL (required when verdict='hitl') */
    hitlContext?: string;
    hitlQuestion?: string;
}
