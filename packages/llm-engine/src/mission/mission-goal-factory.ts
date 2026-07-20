// createMissionGoal — converts a MissionPlan into a Goal for reconcile().
//
// Phase 4 (WP-07): Each TodoItem becomes an AgentRunSpec.
// Dependency edges are typed RunEdges (control only).
//
// Each AgentRunSpec:
//   - id = todo.id
//   - prompt = todo.description (+ feedback on retry)
//   - predicate = 'llm-judge'
//   - canParallel = todo.canParallel
//   - maxRetries = todo.maxRetries

import type { Goal, AgentRunSpec, RunEdge } from '@itookit/common';
import type { MissionPlan } from '@itookit/common';

export function createMissionGoal(plan: MissionPlan): Goal {
    const nodes: AgentRunSpec[] = plan.todos.map(todo => ({
        id: todo.id,
        agent: { id: todo.agentId ?? 'default', version: '1' },
        prompt: todo.description,
        mode: 'loop',
        inputs: [],
        predicate: 'llm-judge',
        canParallel: todo.canParallel,
        maxRetries: todo.maxRetries,
    }));

    // Edges: from → to (control dependency)
    const edges: RunEdge[] = [];
    for (const todo of plan.todos) {
        for (const depId of todo.dependsOn) {
            edges.push({ from: depId, to: todo.id, kind: 'control' });
        }
    }

    return {
        id: plan.id,
        nodes,
        edges: edges.length > 0 ? edges : undefined,
    };
}
