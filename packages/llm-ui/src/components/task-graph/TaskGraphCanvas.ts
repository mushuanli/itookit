import type { FlowDraft, FlowNodeId, TaskNodeDefinition } from '@itookit/common';
import { escapeHTML } from '@itookit/common';

export interface TaskGraphCanvasOptions {
    onSelectNode: (nodeId: FlowNodeId) => void;
    onMoveNode: (nodeId: FlowNodeId, position: { x: number; y: number }) => void;
    onConnect: (from: TaskNodeDefinition, to: TaskNodeDefinition) => void;
}

export class TaskGraphCanvas {
    private pendingSource: FlowNodeId | null = null;

    constructor(
        private readonly root: HTMLElement,
        private readonly options: TaskGraphCanvasOptions,
    ) {}

    render(draft: FlowDraft, selectedId?: FlowNodeId): void {
        const positions = draft.layout.nodes ?? {};
        const zoom = draft.layout.viewport?.zoom ?? 1;
        this.root.innerHTML = `<div class="task-graph-canvas__surface" style="transform:scale(${zoom})">
            <svg class="task-graph-canvas__edges">${draft.edges.map(edge => {
                const from = positions[edge.from] ?? { x: 40, y: 40 };
                const to = positions[edge.to] ?? { x: 40, y: 40 };
                return `<path data-edge-id="${escapeHTML(String(edge.id))}" d="${edgePath(from, to)}" class="is-${edge.kind}"></path>`;
            }).join('')}</svg>
            ${draft.nodes.map(node => renderNode(node, positions[node.id], node.id === selectedId)).join('')}
        </div>`;
        this.bind(draft);
    }

    fit(): void {
        this.root.querySelector('.task-graph-canvas__surface')?.scrollIntoView({
            block: 'nearest',
            inline: 'nearest',
        });
    }

    private bind(draft: FlowDraft): void {
        this.root.querySelectorAll<HTMLElement>('[data-flow-node]').forEach(element => {
            const nodeId = element.dataset.flowNode as FlowNodeId;
            element.addEventListener('click', event => this.handleNodeClick(event, draft, nodeId));
            element.addEventListener('pointerdown', event => this.startDrag(event, nodeId, element));
        });
    }

    private handleNodeClick(event: MouseEvent, draft: FlowDraft, nodeId: FlowNodeId): void {
        event.stopPropagation();
        const node = draft.nodes.find(item => item.id === nodeId);
        if (!node) return;
        if ((event.target as HTMLElement).closest('[data-port="output"]')) {
            this.pendingSource = nodeId;
            return;
        }
        if ((event.target as HTMLElement).closest('[data-port="input"]') && this.pendingSource) {
            const source = draft.nodes.find(item => item.id === this.pendingSource);
            this.pendingSource = null;
            if (source) this.options.onConnect(source, node);
            return;
        }
        this.options.onSelectNode(nodeId);
    }

    private startDrag(event: PointerEvent, nodeId: FlowNodeId, element: HTMLElement): void {
        if ((event.target as HTMLElement).closest('[data-port]')) return;
        const start = { x: event.clientX, y: event.clientY };
        const position = {
            x: Number.parseFloat(element.style.left) || 0,
            y: Number.parseFloat(element.style.top) || 0,
        };
        element.setPointerCapture(event.pointerId);
        const move = (next: PointerEvent) => {
            element.style.left = `${position.x + next.clientX - start.x}px`;
            element.style.top = `${position.y + next.clientY - start.y}px`;
        };
        element.addEventListener('pointermove', move);
        element.addEventListener('pointerup', next => {
            element.removeEventListener('pointermove', move);
            this.options.onMoveNode(nodeId, {
                x: position.x + next.clientX - start.x,
                y: position.y + next.clientY - start.y,
            });
        }, { once: true });
    }
}

function renderNode(
    node: TaskNodeDefinition,
    position = { x: 40, y: 40 },
    selected = false,
): string {
    return `<article class="task-graph-node ${selected ? 'is-selected' : ''}"
        data-flow-node="${escapeHTML(node.id)}" style="left:${position.x}px;top:${position.y}px">
        <button class="task-graph-port task-graph-port--input" data-port="input" title="Connect input"></button>
        <strong>${escapeHTML(node.name)}</strong>
        <small>${escapeHTML(node.handler.kind)}@${escapeHTML(node.handler.version)}</small>
        <button class="task-graph-port task-graph-port--output" data-port="output" title="Connect output"></button>
    </article>`;
}

function edgePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
    const startX = from.x + 180;
    const startY = from.y + 36;
    const endX = to.x;
    const endY = to.y + 36;
    const bend = Math.max(40, Math.abs(endX - startX) / 2);
    return `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`;
}
