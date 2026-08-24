import type { DagPluginManifest, FlowDraft, FlowNodeId, FlowNodeDefinition } from '@itookit/common';
import { escapeHTML } from '@itookit/common';

export interface DagCanvasOptions {
    onSelectNode: (nodeId: FlowNodeId) => void;
    onMoveNode: (nodeId: FlowNodeId, position: { x: number; y: number }) => void;
    onConnect: (from: FlowNodeDefinition, to: FlowNodeDefinition) => void;
}

export class DagCanvas {
    private pendingSource: FlowNodeId | null = null;

    constructor(
        private readonly root: HTMLElement,
        private readonly options: DagCanvasOptions,
    ) {}

    render(
        draft: FlowDraft,
        selectedId?: FlowNodeId,
        manifests?: ReadonlyMap<string, DagPluginManifest>,
    ): void {
        const positions = draft.layout.nodes ?? {};
        const zoom = draft.layout.viewport?.zoom ?? 1;
        const { width, height } = surfaceSize(draft.nodes, positions);
        this.root.innerHTML = `<div class="dag-canvas__surface" style="transform:scale(${zoom});width:${width}px;height:${height}px">
            <svg class="dag-canvas__edges">${edgeDefs()}${draft.edges.map(edge => {
                const from = positions[edge.from] ?? { x: 40, y: 40 };
                const to = positions[edge.to] ?? { x: 40, y: 40 };
                const marker = edge.kind === 'control' ? 'dag-arrow-control' : 'dag-arrow-data';
                return `<path data-edge-id="${escapeHTML(String(edge.id))}" d="${edgePath(from, to)}" class="is-${edge.kind}" marker-end="url(#${marker})"></path>`;
            }).join('')}</svg>
            ${draft.nodes.map(node => renderNode(node, positions[node.id], node.id === selectedId, manifests?.get(node.plugin))).join('')}
        </div>`;
        this.bind(draft);
    }

    fit(): void {
        this.root.querySelector('.dag-canvas__surface')?.scrollIntoView({
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
    node: FlowNodeDefinition,
    position = { x: 40, y: 40 },
    selected = false,
    manifest?: DagPluginManifest,
): string {
    const inputs = portSummary(manifest?.inputs);
    const outputs = portSummary(manifest?.outputs);
    return `<article class="dag-node ${selected ? 'is-selected' : ''}"
        data-flow-node="${escapeHTML(node.id)}" style="left:${position.x}px;top:${position.y}px">
        <button class="dag-port dag-port--input" data-port="input" title="Connect input"></button>
        <strong>${escapeHTML(node.name)}</strong>
        <small class="dag-node__kind">${escapeHTML(manifest?.title ?? node.plugin)}</small>
        ${nodeBadges(node)}
        <small class="dag-node__ports" title="${escapeHTML(node.plugin)}@${escapeHTML(node.pluginVersion)}">In ${escapeHTML(inputs)} · Out ${escapeHTML(outputs)}</small>
        <button class="dag-port dag-port--output" data-port="output" title="Connect output"></button>
    </article>`;
}

/** Strategy badges for builtin.agent nodes: agent reference, history policy, persist, subtask. */
function nodeBadges(node: FlowNodeDefinition): string {
    if (node.plugin !== 'builtin.agent') return '';
    const config = isRecord(node.config) ? node.config : {};
    const badges: string[] = [];
    if (typeof config.agentId === 'string' && config.agentId) {
        badges.push(`<span class="dag-badge dag-badge--agent" title="引用 Agent">${escapeHTML(config.agentId)}</span>`);
    }
    const history = config.historyPolicy === 'none' || config.historyPolicy === 'upstream'
        ? config.historyPolicy : 'inherit';
    badges.push(`<span class="dag-badge dag-badge--history dag-badge--history-${history}" title="History policy">H:${history}</span>`);
    if (config.persistOutput === true) {
        badges.push(`<span class="dag-badge dag-badge--persist" title="Persist output">P</span>`);
    }
    if (config.subtasks) {
        badges.push(`<span class="dag-badge dag-badge--subtask" title="Subtask fan-out">子任务</span>`);
    }
    return badges.length ? `<div class="dag-node__badges">${badges.join('')}</div>` : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Compact port summary for a node card (name* for "many" cardinality). */
function portSummary(ports: Array<{ name: string; cardinality?: string }> | undefined): string {
    if (!ports?.length) return '—';
    return ports.map(port => `${port.name}${port.cardinality === 'many' ? '*' : ''}`).join(', ');
}

function edgePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
    const startX = from.x + 180;
    const startY = from.y + 42;
    const endX = to.x;
    const endY = to.y + 42;
    const bend = Math.max(40, Math.abs(endX - startX) / 2);
    return `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`;
}

/** Arrowhead markers for edge direction (data = solid blue, control = dashed violet). */
function edgeDefs(): string {
    const marker = (id: string, color: string) =>
        `<marker id="${id}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="${color}"></path>
        </marker>`;
    return `<defs>${marker('dag-arrow-data', '#60a5fa')}${marker('dag-arrow-control', '#a78bfa')}</defs>`;
}

/** Grow the surface to fit every node so the canvas can scroll to offscreen nodes. */
function surfaceSize(
    nodes: FlowNodeDefinition[],
    positions: Record<string, { x: number; y: number }>,
): { width: number; height: number } {
    let width = 1200;
    let height = 760;
    for (const node of nodes) {
        const position = positions[node.id] ?? { x: 40, y: 40 };
        width = Math.max(width, position.x + 220);
        height = Math.max(height, position.y + 100);
    }
    return { width, height };
}
