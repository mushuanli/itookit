// createMissionGoal — converts a MissionPlan into a Goal for reconcile().
//
// Each TodoItem becomes a GoalNode:
//   - id = todo.id
//   - task.prompt = todo.description (+ feedback on retry)
//   - predicate = 'llm-judge'
//   - canParallel = todo.canParallel
//   - maxRetries = todo.maxRetries
//
// Dependency edges are derived from TodoItem.dependsOn.

import type { Goal, GoalNode } from '@itookit/common';
import type { MissionPlan } from '@itookit/common';

export function createMissionGoal(plan: MissionPlan): Goal {
    const nodes: GoalNode[] = plan.todos.map(todo => ({
        id: todo.id,
        task: {
            prompt: todo.description,
            mode: 'loop',
            context: {
                title: todo.title,
                agentRole: todo.agentRole,
                agentId: todo.agentId,
                feedback: todo.feedback,
            },
        },
        predicate: 'llm-judge',
        canParallel: todo.canParallel,
        maxRetries: todo.maxRetries,
    }));

    // Edges: [from, to] means 'to' depends on 'from'
    const edges: Array<[string, string]> = [];
    for (const todo of plan.todos) {
        for (const depId of todo.dependsOn) {
            edges.push([depId, todo.id]);
        }
    }

    return {
        id: plan.id,
        nodes,
        edges: edges.length > 0 ? edges : undefined,
    };
}
