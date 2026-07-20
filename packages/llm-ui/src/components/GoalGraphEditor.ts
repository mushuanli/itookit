import type {
    AgentDefinition,
    Goal,
    GoalDefinitionEdge,
    GoalDraft,
    GoalNodeDefinition,
    GoalRevision,
    GoalValidationIssue,
} from '@itookit/common';
import { escapeHTML, simpleHash } from '@itookit/common';
import { GoalDraftConflictError, GoalDraftService } from '@itookit/llm-engine';
import type { IChatEngine } from '@itookit/llm-engine';

export interface GoalGraphEditorOptions {
    engine: IChatEngine;
    nodeId: string;
    agents: () => AgentDefinition[];
    onInspectorVisibilityChange?: (visible: boolean) => void;
    onRun?: (revision: GoalRevision, goal: Goal) => Promise<void> | void;
}

/** Lightweight, dependency-free GoalDraft editor. Domain IDs stay outside the DOM library layer. */
export class GoalGraphEditor {
    private readonly service: GoalDraftService;
    private draft!: GoalDraft;
    private selectedNodeId: string | null = null;
    private selectedEdgeId: string | null = null;
    private undoStack: GoalDraft[] = [];
    private redoStack: GoalDraft[] = [];
    private issues: GoalValidationIssue[] = [];
    private status = '';

    constructor(
        private readonly canvas: HTMLElement,
        private readonly inspector: HTMLElement,
        private readonly options: GoalGraphEditorOptions,
    ) {
        this.service = new GoalDraftService(options.engine, options.nodeId);
    }

    async init(): Promise<void> {
        this.draft = await this.service.loadDraft('main') ?? this.service.createDraft('Agent DAG', 'main');
        this.validate();
        this.render();
    }

    refreshAgents(): void { this.renderInspector(); }

    private render(): void {
        const errorCount = this.issues.filter(issue => issue.severity === 'error').length;
        this.canvas.innerHTML = `
            <div class="llm-goal-editor">
                <div class="llm-goal-editor__toolbar">
                    <input class="llm-goal-editor__name" value="${escapeHTML(this.draft.name)}" aria-label="DAG name" />
                    <button data-action="add-node">+ Agent node</button>
                    <button data-action="validate">Validate${errorCount ? ` (${errorCount})` : ''}</button>
                    <button data-action="undo" ${this.undoStack.length ? '' : 'disabled'}>Undo</button>
                    <button data-action="redo" ${this.redoStack.length ? '' : 'disabled'}>Redo</button>
                    <button data-action="save">Save</button>
                    <button class="llm-goal-editor__run" data-action="run" ${errorCount ? 'disabled' : ''}>Run</button>
                    <span class="llm-goal-editor__status" role="status">${escapeHTML(this.status)}</span>
                </div>
                <div class="llm-goal-editor__body">
                    <div class="llm-goal-editor__canvas" role="list" aria-label="DAG nodes">
                        ${this.draft.nodes.length ? this.draft.nodes.map(node => this.renderNode(node)).join('') : this.renderEmpty()}
                    </div>
                    <div class="llm-goal-editor__edges" aria-label="DAG edges">
                        <div class="llm-goal-editor__section-title">Edges (${this.draft.edges.length})</div>
                        ${this.draft.edges.length ? this.draft.edges.map(edge => this.renderEdge(edge)).join('') : '<span class="llm-goal-editor__muted">No dependencies</span>'}
                    </div>
                    ${this.renderIssues()}
                </div>
            </div>`;
        this.bindCanvasEvents();
        this.renderInspector();
    }

    private renderNode(node: GoalNodeDefinition): string {
        const selected = node.id === this.selectedNodeId ? ' is-selected' : '';
        const invalid = this.issues.some(issue => issue.nodeId === node.id && issue.severity === 'error');
        const agent = this.options.agents().find(item => item.id === node.agent.id);
        return `<article class="llm-goal-node${selected}${invalid ? ' is-invalid' : ''}" role="listitem" data-node-id="${escapeHTML(node.id)}" tabindex="0">
            <div class="llm-goal-node__header">
                <span>${escapeHTML(agent?.icon ?? '🤖')}</span>
                <strong>${escapeHTML(node.label)}</strong>
                <span class="llm-goal-node__version">${escapeHTML(node.agent.version ?? 'unversioned')}</span>
            </div>
            <div class="llm-goal-node__agent">${escapeHTML(agent?.name ?? (node.agent.id || 'No agent'))}</div>
            <div class="llm-goal-node__prompt">${escapeHTML(node.prompt || 'No prompt')}</div>
            <div class="llm-goal-node__footer">
                <span>${escapeHTML(node.joinPolicy ?? 'all-success')}</span>
                <button data-node-action="duplicate" title="Duplicate node">Duplicate</button>
                <button data-node-action="delete" title="Delete node">Delete</button>
            </div>
        </article>`;
    }

    private renderEdge(edge: GoalDefinitionEdge): string {
        const from = this.draft.nodes.find(node => node.id === edge.from)?.label ?? edge.from;
        const to = this.draft.nodes.find(node => node.id === edge.to)?.label ?? edge.to;
        return `<button class="llm-goal-edge${edge.id === this.selectedEdgeId ? ' is-selected' : ''}" data-edge-id="${escapeHTML(edge.id)}">
            <span class="llm-goal-edge__kind">${edge.kind}</span>
            ${escapeHTML(from)} → ${escapeHTML(to)}
            ${edge.kind === 'data' ? `<small>${escapeHTML(edge.outputPort ?? '?')} → ${escapeHTML(edge.inputPort ?? '?')}</small>` : ''}
        </button>`;
    }

    private renderEmpty(): string {
        return `<button class="llm-goal-editor__empty" data-action="add-node">
            <strong>Create the first Agent node</strong><span>Build a reusable execution DAG.</span>
        </button>`;
    }

    private renderIssues(): string {
        if (!this.issues.length) return '';
        return `<div class="llm-goal-editor__issues" role="alert">
            <div class="llm-goal-editor__section-title">Validation</div>
            ${this.issues.map(issue => `<div>${issue.severity === 'error' ? '●' : '○'} ${escapeHTML(issue.message)}</div>`).join('')}
        </div>`;
    }

    private bindCanvasEvents(): void {
        this.canvas.querySelector<HTMLInputElement>('.llm-goal-editor__name')?.addEventListener('change', event => {
            const value = (event.currentTarget as HTMLInputElement).value.trim() || 'Agent DAG';
            this.mutate(draft => ({ ...draft, name: value, updatedAt: Date.now() }));
        });
        this.canvas.querySelectorAll<HTMLElement>('[data-action]').forEach(element => {
            element.addEventListener('click', () => this.handleAction(element.dataset.action!));
        });
        this.canvas.querySelectorAll<HTMLElement>('[data-node-id]').forEach(element => {
            element.addEventListener('click', event => {
                const action = (event.target as HTMLElement).closest<HTMLElement>('[data-node-action]')?.dataset.nodeAction;
                const id = element.dataset.nodeId!;
                if (action === 'duplicate') return void this.mutate(draft => this.service.duplicateNode(draft, id));
                if (action === 'delete') return void this.deleteNode(id);
                this.selectedNodeId = id;
                this.selectedEdgeId = null;
                this.render();
            });
        });
        this.canvas.querySelectorAll<HTMLElement>('[data-edge-id]').forEach(element => {
            element.addEventListener('click', () => {
                this.selectedEdgeId = element.dataset.edgeId!;
                this.selectedNodeId = null;
                this.render();
            });
        });
    }

    private async handleAction(action: string): Promise<void> {
        if (action === 'add-node') {
            const agent = this.options.agents()[0];
            if (!agent) { this.status = 'Create an Agent definition first.'; return this.render(); }
            const before = this.draft.nodes.length;
            await this.mutate(draft => this.service.addNode(draft, {
                agent: { id: agent.id, version: this.agentVersion(agent) }, label: agent.name,
                outputPorts: agent.interface?.outputs.map(output => output.name) ?? ['final'],
            }));
            this.selectedNodeId = this.draft.nodes[before]?.id ?? null;
            this.render();
        } else if (action === 'validate') {
            this.validate(); this.status = this.issues.length ? `${this.issues.length} issue(s)` : 'DAG is valid'; this.render();
        } else if (action === 'save') {
            await this.persist();
        } else if (action === 'undo') {
            await this.undo();
        } else if (action === 'redo') {
            await this.redo();
        } else if (action === 'run') {
            await this.run();
        }
    }

    private renderInspector(): void {
        const node = this.draft.nodes.find(item => item.id === this.selectedNodeId);
        const edge = this.draft.edges.find(item => item.id === this.selectedEdgeId);
        this.options.onInspectorVisibilityChange?.(!!node || !!edge);
        if (!node && !edge) { this.inspector.innerHTML = ''; return; }
        if (edge) return this.renderEdgeInspector(edge);

        const agentOptions = this.options.agents().map(agent =>
            `<option value="${escapeHTML(agent.id)}" ${agent.id === node!.agent.id ? 'selected' : ''}>${escapeHTML(agent.name)}</option>`).join('');
        const targetOptions = this.draft.nodes.filter(item => item.id !== node!.id).map(item =>
            `<option value="${escapeHTML(item.id)}">${escapeHTML(item.label)}</option>`).join('');
        this.inspector.innerHTML = `<div class="llm-goal-inspector">
            <div class="llm-goal-inspector__header"><strong>Agent node</strong><button data-close>×</button></div>
            <label>Label<input name="label" value="${escapeHTML(node!.label)}" /></label>
            <label>Agent<select name="agent">${agentOptions}</select></label>
            <label>Frozen version<input name="agentVersion" value="${escapeHTML(node!.agent.version ?? '')}" /></label>
            <label>Prompt<textarea name="prompt" rows="7">${escapeHTML(node!.prompt)}</textarea></label>
            <label>Join policy<select name="joinPolicy">
                ${['all-success', 'all-settled', 'any-success'].map(value => `<option ${node!.joinPolicy === value ? 'selected' : ''}>${value}</option>`).join('')}
            </select></label>
            <label>Max retries<input name="maxRetries" type="number" min="0" value="${node!.maxRetries ?? 0}" /></label>
            <button data-save-node>Save node</button>
            <hr />
            <strong>Add dependency</strong>
            <label>Target<select name="target">${targetOptions}</select></label>
            <label>Kind<select name="edgeKind"><option value="control">control</option><option value="data">data</option></select></label>
            <div class="llm-goal-inspector__ports" hidden>
                <label>Output port<input name="outputPort" value="${escapeHTML(node!.outputPorts?.[0] ?? 'final')}" /></label>
                <label>Input port<input name="inputPort" value="source" /></label>
            </div>
            <button data-add-edge ${targetOptions ? '' : 'disabled'}>Connect</button>
        </div>`;
        this.bindNodeInspector(node!);
    }

    private bindNodeInspector(node: GoalNodeDefinition): void {
        this.inspector.querySelector('[data-close]')?.addEventListener('click', () => { this.selectedNodeId = null; this.render(); });
        const agentSelect = this.inspector.querySelector<HTMLSelectElement>('[name="agent"]')!;
        agentSelect.addEventListener('change', () => {
            const selected = this.options.agents().find(agent => agent.id === agentSelect.value);
            const versionInput = this.inspector.querySelector<HTMLInputElement>('[name="agentVersion"]');
            if (selected && versionInput) versionInput.value = this.agentVersion(selected);
        });
        const kind = this.inspector.querySelector<HTMLSelectElement>('[name="edgeKind"]')!;
        const ports = this.inspector.querySelector<HTMLElement>('.llm-goal-inspector__ports')!;
        kind.addEventListener('change', () => { ports.hidden = kind.value !== 'data'; });
        this.inspector.querySelector('[data-save-node]')?.addEventListener('click', () => {
            const agentId = this.value('agent');
            const agent = this.options.agents().find(item => item.id === agentId);
            this.mutate(draft => this.service.updateNode(draft, node.id, {
                label: this.value('label').trim() || node.label,
                agent: { id: agentId, version: this.value('agentVersion').trim() || (agent ? this.agentVersion(agent) : undefined) },
                prompt: this.value('prompt'),
                joinPolicy: this.value('joinPolicy') as GoalNodeDefinition['joinPolicy'],
                maxRetries: Number(this.value('maxRetries')) || 0,
                outputPorts: agent?.interface?.outputs.map(output => output.name) ?? ['final'],
            }));
        });
        this.inspector.querySelector('[data-add-edge]')?.addEventListener('click', () => {
            const edgeKind = this.value('edgeKind') as 'control' | 'data';
            this.mutate(draft => this.service.addEdge(draft, {
                from: node.id, to: this.value('target'), kind: edgeKind,
                outputPort: edgeKind === 'data' ? this.value('outputPort') : undefined,
                inputPort: edgeKind === 'data' ? this.value('inputPort') : undefined,
            }));
        });
    }

    private renderEdgeInspector(edge: GoalDefinitionEdge): void {
        this.inspector.innerHTML = `<div class="llm-goal-inspector">
            <div class="llm-goal-inspector__header"><strong>${escapeHTML(edge.kind)} edge</strong><button data-close>×</button></div>
            <p>${escapeHTML(edge.from)} → ${escapeHTML(edge.to)}</p>
            ${edge.kind === 'data' ? `<label>Output port<input name="outputPort" value="${escapeHTML(edge.outputPort ?? '')}" /></label>
                <label>Input port<input name="inputPort" value="${escapeHTML(edge.inputPort ?? '')}" /></label>
                <button data-save-edge>Save edge</button>` : ''}
            <button class="llm-goal-inspector__danger" data-delete-edge>Delete edge</button>
        </div>`;
        this.inspector.querySelector('[data-close]')?.addEventListener('click', () => { this.selectedEdgeId = null; this.render(); });
        this.inspector.querySelector('[data-save-edge]')?.addEventListener('click', () => this.mutate(draft => this.service.updateEdge(draft, edge.id, {
            outputPort: this.value('outputPort'), inputPort: this.value('inputPort'),
        })));
        this.inspector.querySelector('[data-delete-edge]')?.addEventListener('click', () => {
            this.selectedEdgeId = null;
            this.mutate(draft => this.service.removeEdge(draft, edge.id));
        });
    }

    private value(name: string): string {
        return this.inspector.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[name="${name}"]`)?.value ?? '';
    }

    private async deleteNode(id: string): Promise<void> {
        const edgeCount = this.draft.edges.filter(edge => edge.from === id || edge.to === id).length;
        if (!confirm(`Delete this node and ${edgeCount} connected edge(s)?`)) return;
        this.selectedNodeId = null;
        await this.mutate(draft => this.service.removeNode(draft, id).draft);
    }

    private async mutate(change: (draft: GoalDraft) => GoalDraft): Promise<void> {
        const before = this.clone(this.draft);
        this.draft = change(this.draft);
        this.undoStack.push(before);
        this.redoStack = [];
        this.validate();
        await this.persist();
    }

    private async persist(): Promise<void> {
        try {
            this.draft = await this.service.saveDraft(this.draft, this.draft.draftVersion);
            this.status = `Saved v${this.draft.draftVersion}`;
        } catch (error) {
            this.status = error instanceof GoalDraftConflictError ? 'Draft changed elsewhere; reopen the designer.' : `Save failed: ${(error as Error).message}`;
        }
        this.render();
    }

    private async undo(): Promise<void> {
        const previous = this.undoStack.pop();
        if (!previous) return;
        this.redoStack.push(this.clone(this.draft));
        this.draft = { ...previous, draftVersion: this.draft.draftVersion };
        this.validate();
        await this.persist();
    }

    private async redo(): Promise<void> {
        const next = this.redoStack.pop();
        if (!next) return;
        this.undoStack.push(this.clone(this.draft));
        this.draft = { ...next, draftVersion: this.draft.draftVersion };
        this.validate();
        await this.persist();
    }

    private validate(): void { this.issues = this.service.validate(this.draft); }

    private async run(): Promise<void> {
        this.validate();
        if (this.issues.some(issue => issue.severity === 'error')) { this.status = 'Fix validation errors before Run.'; return this.render(); }
        try {
            const revision = await this.service.createRevision(this.draft);
            const goal = this.service.instantiate(revision);
            await this.options.onRun?.(revision, goal);
            this.status = `Revision ${revision.revision} frozen`;
        } catch (error) { this.status = (error as Error).message; }
        this.render();
    }

    private agentVersion(agent: AgentDefinition): string {
        return agent.version ?? `legacy-${simpleHash(JSON.stringify(agent))}`;
    }

    private clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
}
