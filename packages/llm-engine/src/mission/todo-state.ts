// @file: llm-engine/src/mission/todo-state.ts
// Atomic read/write of MissionPlan (plan.json) in VFS.

import type { IVFSManager } from '@itookit/common';
import type { MissionPlan, TodoItem, MissionStatus, TodoStatus } from '@itookit/common';
import { MISSION_MODULE } from '@itookit/common';
import { BaseModuleService } from '@itookit/vfslib';

export class TodoStateManager extends BaseModuleService {
    constructor(vfs: IVFSManager) {
        super(MISSION_MODULE, { description: 'Mission orchestration state' }, vfs);
    }

    protected async onLoad(): Promise<void> {}

    // ── Mission lifecycle ────────────────────────────────────

    async createMission(plan: MissionPlan): Promise<void> {
        await this.ensureDirectory(`/${plan.id}/results`);
        await this.ensureDirectory(`/${plan.id}/summaries`);
        await this.ensureDirectory(`/${plan.id}/hitl`);
        await this.writeJson(plan.paths.planFile, plan);
    }

    async getPlan(missionId: string): Promise<MissionPlan | null> {
        return this.readJson<MissionPlan>(`/${missionId}/plan.json`);
    }

    async updateMissionStatus(missionId: string, status: MissionStatus): Promise<void> {
        const plan = await this.getPlan(missionId);
        if (!plan) return;
        plan.status = status;
        plan.updatedAt = Date.now();
        await this.writeJson(plan.paths.planFile, plan);
    }

    // ── Todo operations ──────────────────────────────────────

    async updateTodo(missionId: string, todoId: string, patch: Partial<TodoItem>): Promise<void> {
        const plan = await this.getPlan(missionId);
        if (!plan) throw new Error(`Mission ${missionId} not found`);
        const idx = plan.todos.findIndex(t => t.id === todoId);
        if (idx < 0) throw new Error(`Todo ${todoId} not found in mission ${missionId}`);
        plan.todos[idx] = { ...plan.todos[idx], ...patch };
        plan.updatedAt = Date.now();
        await this.writeJson(plan.paths.planFile, plan);
    }

    async markTodosRunning(missionId: string, todoIds: string[]): Promise<void> {
        const plan = await this.getPlan(missionId);
        if (!plan) return;
        let changed = false;
        for (const todo of plan.todos) {
            if (todoIds.includes(todo.id) && todo.status === 'pending') {
                todo.status = 'running';
                changed = true;
            }
        }
        if (changed) {
            plan.updatedAt = Date.now();
            await this.writeJson(plan.paths.planFile, plan);
        }
    }

    // ── Journal ──────────────────────────────────────────────

    async appendJournal(missionId: string, entry: string): Promise<void> {
        const path = `/${missionId}/journal.md`;
        const ts = new Date().toISOString().slice(0, 16).replace('T', ' ');
        const line = `[${ts}] ${entry}\n`;
        let existing = '';
        try {
            const raw = await this.vfs.read(this.moduleName, path);
            existing = typeof raw === 'string' ? raw : new TextDecoder().decode(raw as ArrayBuffer);
        } catch {
            // First journal entry — file doesn't exist yet
        }
        await this.vfs.write(this.moduleName, path, existing + line);
    }

    // ── Pure scheduling helpers ──────────────────────────────

    /** Returns todos that are ready to be scheduled (pending + all deps done). */
    getReadyTodos(plan: MissionPlan): TodoItem[] {
        const doneIds = new Set(
            plan.todos.filter(t => t.status === 'done').map(t => t.id),
        );
        const runningCount = plan.todos.filter(t => t.status === 'running').length;
        const available = plan.config.maxParallelAgents - runningCount;
        if (available <= 0) return [];

        const ready = plan.todos.filter(
            t => t.status === 'pending' && t.dependsOn.every(depId => doneIds.has(depId)),
        );
        // Higher priority first
        ready.sort((a, b) => b.priority - a.priority);
        return ready.slice(0, available);
    }

    /** True when all todos are in a terminal state. */
    isComplete(plan: MissionPlan): boolean {
        return plan.todos.every(t =>
            (t.status as TodoStatus) === 'done' ||
            (t.status as TodoStatus) === 'failed' ||
            (t.status as TodoStatus) === 'skipped',
        );
    }

    /** Propagate 'skipped' to todos whose dependencies have failed. */
    async propagateSkipped(missionId: string): Promise<void> {
        const plan = await this.getPlan(missionId);
        if (!plan) return;
        const failedIds = new Set(plan.todos.filter(t => t.status === 'failed').map(t => t.id));
        let changed = false;
        for (const todo of plan.todos) {
            if (todo.status === 'pending' && todo.dependsOn.some(d => failedIds.has(d))) {
                todo.status = 'skipped';
                changed = true;
            }
        }
        if (changed) {
            plan.updatedAt = Date.now();
            await this.writeJson(plan.paths.planFile, plan);
        }
    }
}
