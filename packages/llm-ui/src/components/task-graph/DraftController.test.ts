import { describe, expect, it } from 'vitest';
import type { FlowDraft, TaskEdgeId } from '@itookit/common';
import { BUILTIN_TASK_KIND_DESCRIPTORS } from '@itookit/llm-engine';
import {
    TaskGraphDraftController,
    createTaskEdge,
} from './DraftController';
import { validateSchema } from './SchemaForm';
import { FloatingNavPanelTemplates } from '../templates/FloatingNavPanelTemplates';

function draft(): FlowDraft {
    return {
        id: 'flow' as FlowDraft['id'],
        draftVersion: 1,
        name: 'Flow',
        nodes: [],
        edges: [],
        layout: {},
        updatedAt: 1,
    };
}

describe('TaskGraphDraftController', () => {
    it('creates all seven built-in nodes from serializable descriptors', () => {
        const controller = new TaskGraphDraftController(draft());
        BUILTIN_TASK_KIND_DESCRIPTORS.forEach(item => controller.addNode(item));
        expect(controller.value.nodes.map(node => node.handler.kind)).toEqual([
            'agent', 'route', 'transform', 'reduce', 'human', 'subflow', 'spawn',
        ]);
        expect(controller.value.nodes.every(node => node.retryPolicy.maxAttempts > 0)).toBe(true);
    });

    it('duplicates without edges and deletes incident edges atomically', () => {
        const controller = new TaskGraphDraftController(draft());
        const transform = BUILTIN_TASK_KIND_DESCRIPTORS.find(item => item.handler.kind === 'transform')!;
        const first = controller.addNode(transform);
        const second = controller.addNode(transform);
        controller.addEdge(createTaskEdge(first, second, 'data'));
        const copy = controller.duplicateNode(first.id);
        expect(controller.value.edges).toHaveLength(1);
        expect(copy.id).not.toBe(first.id);
        expect(controller.deleteNode(second.id).incidentEdgeCount).toBe(1);
        expect(controller.value.edges).toHaveLength(0);
    });

    it('rejects cycles and cleans route edge references', () => {
        const controller = new TaskGraphDraftController(draft());
        const routeKind = BUILTIN_TASK_KIND_DESCRIPTORS.find(item => item.handler.kind === 'route')!;
        const transformKind = BUILTIN_TASK_KIND_DESCRIPTORS.find(item => item.handler.kind === 'transform')!;
        const route = controller.addNode(routeKind);
        const target = controller.addNode(transformKind);
        const edge = createTaskEdge(route, target, 'control');
        controller.addEdge(edge);
        controller.updateNode({
            ...route,
            config: {
                mode: 'fallback',
                rules: [],
                defaultEdgeId: edge.id,
            },
        });
        expect(() => controller.addEdge(createTaskEdge(target, route, 'control'))).toThrow(/cycle/);
        controller.deleteEdge(edge.id as TaskEdgeId);
        expect(controller.value.nodes[0].config).not.toHaveProperty('defaultEdgeId');
    });

    it('supports undo/redo and nested schema validation', () => {
        const controller = new TaskGraphDraftController(draft());
        controller.addNode(BUILTIN_TASK_KIND_DESCRIPTORS[0]);
        expect(controller.undo()).toBe(true);
        expect(controller.value.nodes).toHaveLength(0);
        expect(controller.redo()).toBe(true);
        const schema = { type: 'object', required: ['mode'], properties: {
            mode: { type: 'string', enum: ['a', 'b'] },
            children: { type: 'array', items: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
        } };
        expect(validateSchema(schema, { mode: 'c', children: [{}] })).toEqual([
            '$.mode is not an allowed value',
            '$.children[0].id is required',
        ]);
    });

    it('renders the Navigator plus button as a grouped creation entry', () => {
        const html = FloatingNavPanelTemplates.renderBranchActions({
            id: 'message',
            roundId: 'round',
            role: 'user',
            preview: '',
            isCollapsed: false,
            index: 0,
            timestamp: 1,
        });
        expect(html).toContain('data-action="open-create-menu"');
        expect(html).not.toContain('data-action="create-branch"');
    });
});
