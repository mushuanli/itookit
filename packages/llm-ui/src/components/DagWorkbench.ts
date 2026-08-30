import type {
    FlowDraft,
    FlowNodeId,
    FlowRevision,
    ICommandBus,
    FlowEdgeDefinition,
    DagPluginManifest,
    DagPluginPresentation,
    FlowNodeDefinition,
    JsonValue,
} from '@itookit/common';
import type { DurableFlowSnapshot } from '@itookit/llm-session';
import { FlowCommand } from '@itookit/llm-session';
import type { TaskSnapshot, TaskStatus } from '@itookit/durable-kernel';
import {escapeHTML} from '@itookit/common';
import { showConfirmDialog, Toast } from '@itookit/ui-common';
import { DagDraftController, createFlowEdge } from './dag/DagDraftController';
import { SchemaForm } from './dag/SchemaForm';
import { DagCanvas } from './dag/DagCanvas';
import { openFlowSettings } from './dag/FlowSettingsDialog';
import type { EntityOption } from './dag/FlowSettingsDialog';

export interface DagWorkbenchOptions {
    commands: ICommandBus;
    onModeChange?: (mode: 'design' | 'run') => void;
    onSelectFlow?: (flowId: string, revision: number) => void;
    /** Global LLM connections available to bind flow-level connection slots to. */
    listConnections?: () => Promise<Array<{ id: string; name: string }>>;
    listAgents?: () => Promise<EntityOption[]>;
    listSystemPrompts?: () => Promise<EntityOption[]>;
    listTools?: () => Promise<EntityOption[]>;
    listSkills?: () => Promise<EntityOption[]>;
}

export class DagWorkbench {
    private mode: 'design' | 'run' = 'design';
    private controller: DagDraftController | null = null;
    private run: DurableFlowSnapshot | null = null;
    private catalogue: DagPluginPresentation[] = [];
    private selectedNodeId?: FlowNodeId;
    private selectedEdgeId?: string;
    private canvas?: DagCanvas;
    private runRefreshTimer?: ReturnType<typeof setTimeout>;

    constructor(
        private readonly root: HTMLElement,
        private readonly options: DagWorkbenchOptions,
    ) {}

    async initialize(): Promise<void> {
        this.catalogue = await this.options.commands.execute<DagPluginPresentation[]>(
            FlowCommand.Presentations,
        );
        this.render();
    }

    setDraft(draft: FlowDraft, selectedNodeId?: FlowNodeId): void {
        this.stopRunRefresh();
        this.controller = new DagDraftController(draft);
        this.selectedNodeId = selectedNodeId;
        this.selectedEdgeId = undefined;
        this.setMode('design');
    }

    async loadDraft(id: string, selectedNodeId?: FlowNodeId): Promise<void> {
        const draft = await this.options.commands.execute<FlowDraft | null>(FlowCommand.DraftLoad, { id });
        if (!draft) throw new Error(`Flow draft not found: ${id}`);
        this.setDraft(draft, selectedNodeId);
    }

    async addNode(
        descriptor: DagPluginManifest,
    ): Promise<FlowNodeDefinition | null> {
        if (!this.controller) return null;
        const node = this.controller.addNode(descriptor);
        this.selectedNodeId = node.id;
        this.selectedEdgeId = undefined;
        this.render();
        return node;
    }

    async openRun(taskId: string): Promise<void> {
        this.run = await this.options.commands.execute<DurableFlowSnapshot>(FlowCommand.RunGet, { taskId });
        this.setMode('run');
        this.scheduleRunRefresh(taskId);
    }

    render(): void {
        this.mode === 'design' ? this.renderDesign() : this.renderRun();
    }

    async cancel(): Promise<void> {
        if (!this.run) return;
        await this.options.commands.execute(FlowCommand.RunCancel, { taskId: this.run.root.task.id });
    }

    destroy(): void {
        this.stopRunRefresh();
        this.root.innerHTML = '';
    }

    private renderDesign(): void {
        const draft = this.controller?.value;
        this.root.innerHTML = `<section class="dag-workbench" data-mode="design">
            ${this.renderToolbar(draft)}
            <div class="dag-workbench__body">
                <div class="dag-canvas"></div>
                <aside class="dag-inspector"></aside>
            </div>
            <footer class="dag-validation" aria-live="polite"></footer>
        </section>`;
        this.bindToolbar();
        if (!draft) return this.renderEmpty();
        this.renderCanvas(draft);
        this.renderInspector(draft);
        void this.refreshValidation(draft);
    }

    private renderToolbar(draft: FlowDraft | undefined): string {
        const addOptions = this.catalogue.map((item, index) =>
            `<option value="${index}">${escapeHTML(paletteLabel(item))}</option>`,
        ).join('');
        return `<header class="dag-toolbar">
            <strong>Flow Design</strong>
            <span>${escapeHTML(draft?.name ?? 'No Flow selected')}</span>
            <select data-action="add-kind" ${draft ? '' : 'disabled'}><option value="">Add node…</option>${addOptions}</select>
            <button data-action="undo" ${draft ? '' : 'disabled'}>Undo</button>
            <button data-action="redo" ${draft ? '' : 'disabled'}>Redo</button>
            <button data-action="layout" ${draft ? '' : 'disabled'}>Auto layout</button>
            <button data-action="zoom-out" ${draft ? '' : 'disabled'}>−</button>
            <button data-action="zoom-in" ${draft ? '' : 'disabled'}>＋</button>
            <button data-action="fit" ${draft ? '' : 'disabled'}>Fit</button>
            <button data-action="settings" ${draft ? '' : 'disabled'}>Settings</button>
            <button data-action="save" ${draft ? '' : 'disabled'}>Save</button>
            <button data-action="publish" ${draft ? '' : 'disabled'}>Publish</button>
            <button data-action="run" ${draft ? '' : 'disabled'}>Run</button>
        </header>`;
    }

    private renderEmpty(): void {
        const canvas = this.root.querySelector('.dag-canvas');
        if (canvas) canvas.innerHTML = '<p class="dag-empty">Create a workflow from the sidebar, or select one to start designing.</p>';
    }

    private renderCanvas(draft: FlowDraft): void {
        const root = this.root.querySelector<HTMLElement>('.dag-canvas')!;
        const manifests = new Map(this.catalogue.map(item => [item.manifest.id, item.manifest]));
        this.canvas = new DagCanvas(root, {
            onSelectNode: id => this.selectNode(id),
            onSelectEdge: id => this.selectEdge(id),
            onSelectCanvas: () => this.selectCanvas(),
            onMoveNode: (id, position) => this.moveNode(id, position),
            onConnect: (from, to) => this.connectNodes(from, to),
            onEditNode: id => void this.openNodeEditor(id),
        });
        this.canvas.render(draft, this.selectedNodeId, manifests, this.selectedEdgeId);
    }

    private async renderInspector(draft: FlowDraft): Promise<void> {
        const inspector = this.root.querySelector<HTMLElement>('.dag-inspector')!;
        const edge = draft.edges.find(item => String(item.id) === this.selectedEdgeId);
        if (edge) {
            this.renderInlineEdgeEditor(inspector, draft, edge);
            return;
        }
        const node = draft.nodes.find(item => item.id === this.selectedNodeId);
        if (!node) {
            inspector.innerHTML = this.renderFlowOverview(draft) + this.renderEdgeList(draft);
            inspector.querySelector('[data-inspector-settings]')?.addEventListener('click', () => void this.openFlowSettings());
            this.bindEdgeActions(inspector);
            return;
        }
        const presentation = this.findPresentation(node);
        if (!presentation) return;
        const formValue = node.plugin === 'builtin.agent' ? canonicalAgentConfig(node.config) : node.config;
        inspector.innerHTML = `<h3 style="margin-bottom:.25rem">Edit node</h3>
            <small>${escapeHTML(node.plugin)} · ${escapeHTML(node.id)}</small>
            <label class="dag-schema-field"><span>Name</span><input data-inline-node-name value="${escapeHTML(node.name)}"></label>
            <div data-inline-config><p style="color:var(--llm-text-secondary,#9ca3af)">Loading configuration…</p></div>
            <div class="dag-inspector__actions">
                <button data-node-action="save" class="is-primary">Save node</button>
                <button data-node-action="duplicate">Duplicate</button>
                <button data-node-action="delete">Delete</button>
            </div>
            <details><summary>Advanced scheduling</summary>
                <label>Static inputs<textarea data-inline-inputs rows="4">${escapeHTML(JSON.stringify(node.inputs, null, 2))}</textarea></label>
                <label>Legacy capabilities<textarea data-inline-capabilities rows="3">${escapeHTML(JSON.stringify(node.capabilities ?? [], null, 2))}</textarea></label>
                <label>Budget<textarea data-inline-budget rows="3">${escapeHTML(JSON.stringify(node.budget ?? {}, null, 2))}</textarea></label>
                <label>Retry policy<textarea data-inline-retry rows="3">${escapeHTML(JSON.stringify(node.retry ?? {}, null, 2))}</textarea></label>
                <label>Compensation node<select data-inline-compensate><option value="">None</option>${draft.nodes.filter(item => item.id !== node.id).map(item => `<option value="${escapeHTML(item.id)}" ${item.id === node.compensate ? 'selected' : ''}>${escapeHTML(item.name)}</option>`).join('')}</select></label>
                <label>Priority<input data-inline-priority type="number" value="${node.priority ?? 0}"></label>
            </details>`;
        let schema = withConnectionEnum(presentation.manifest.configSchema, draft, formValue);
        if (node.plugin === 'builtin.agent') {
            const [agents, prompts, tools, skills] = await Promise.all([
                this.options.listAgents?.() ?? Promise.resolve([]),
                this.options.listSystemPrompts?.() ?? Promise.resolve([]),
                this.options.listTools?.() ?? Promise.resolve([]),
                this.options.listSkills?.() ?? Promise.resolve([]),
            ]);
            if (this.selectedNodeId !== node.id || !inspector.isConnected) return;
            schema = withAgentEntityEnums(schema, formValue, { agents, prompts, tools, skills });
        } else if (node.plugin === 'builtin.flow') {
            const flows = await this.options.commands.execute<FlowDraft[]>(FlowCommand.DraftList);
            schema = withCompositeFlowEnum(schema, formValue, flows);
        }
        const formRoot = inspector.querySelector<HTMLElement>('[data-inline-config]')!;
        const schemaForm = new SchemaForm(formRoot, schema, formValue, presentation.ui?.inspector.layout);
        schemaForm.render();
        if (node.plugin === 'builtin.spawn') enhanceSpawnForm(formRoot);
        inspector.querySelector('[data-node-action="save"]')?.addEventListener('click', () => {
            try {
                const config = schemaForm.read();
                if (config.errors.length || config.value === undefined) throw new Error(config.errors.join('; '));
                const read = (selector: string) => inspector.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!.value;
                this.controller?.updateNode({
                    ...node,
                    name: read('[data-inline-node-name]').trim() || node.name,
                    config: node.plugin === 'builtin.agent' ? canonicalAgentConfig(config.value) : config.value,
                    inputs: JSON.parse(read('[data-inline-inputs]')),
                    capabilities: JSON.parse(read('[data-inline-capabilities]')),
                    budget: JSON.parse(read('[data-inline-budget]')),
                    retry: JSON.parse(read('[data-inline-retry]')),
                    compensate: (read('[data-inline-compensate]') || undefined) as FlowNodeDefinition['compensate'],
                    priority: Number(read('[data-inline-priority]')),
                });
                this.render();
                Toast.success('Node updated');
            } catch (error) {
                Toast.error(error instanceof Error ? error.message : 'Invalid node settings');
            }
        });
        inspector.querySelector('[data-node-action="duplicate"]')?.addEventListener('click', () => {
            this.selectedNodeId = this.controller?.duplicateNode(node.id).id;
            this.render();
        });
        inspector.querySelector('[data-node-action="delete"]')?.addEventListener('click', () => void this.confirmDeleteNode(node.id));
    }

    private renderInlineEdgeEditor(
        inspector: HTMLElement,
        draft: FlowDraft,
        edge: FlowEdgeDefinition,
    ): void {
        const from = draft.nodes.find(node => node.id === edge.from);
        const to = draft.nodes.find(node => node.id === edge.to);
        const source = from && this.findDescriptor(from);
        const target = to && this.findDescriptor(to);
        inspector.innerHTML = `<h3 style="margin-bottom:.25rem">Edit connection</h3>
            <small>${escapeHTML(from?.name ?? edge.from)} → ${escapeHTML(to?.name ?? edge.to)}</small>
            <label>Kind<select data-edge-kind><option value="data" ${edge.kind === 'data' ? 'selected' : ''}>Data</option><option value="control" ${edge.kind === 'control' ? 'selected' : ''}>Control</option></select></label>
            <label>Source output<select data-edge-output>${portOptions(source?.outputs, edge.output)}</select></label>
            <label>Target input<select data-edge-input>${portOptions(target?.inputs, edge.input)}</select></label>
            <label>When upstream fails<select data-edge-on-failure><option value="fail" ${!edge.onFailure || edge.onFailure === 'fail' ? 'selected' : ''}>Fail downstream</option><option value="skip" ${edge.onFailure === 'skip' ? 'selected' : ''}>Skip downstream</option><option value="continue" ${edge.onFailure === 'continue' ? 'selected' : ''}>Continue with failure result</option></select></label>
            <p style="color:var(--llm-text-secondary,#9ca3af);font-size:.8rem">Data connections carry a named output into a named input. Control connections only determine execution order.</p>
            <div class="dag-inspector__actions">
                <button data-edge-save class="is-primary">Save connection</button>
                <button data-edge-delete>Delete</button>
            </div>`;
        inspector.querySelector('[data-edge-save]')?.addEventListener('click', () => {
            const kind = inspector.querySelector<HTMLSelectElement>('[data-edge-kind]')!.value as FlowEdgeDefinition['kind'];
            const output = inspector.querySelector<HTMLSelectElement>('[data-edge-output]')!.value;
            const input = inspector.querySelector<HTMLSelectElement>('[data-edge-input]')!.value;
            const onFailure = inspector.querySelector<HTMLSelectElement>('[data-edge-on-failure]')!.value as NonNullable<FlowEdgeDefinition['onFailure']>;
            try {
                this.controller?.updateEdge({ ...edge, kind, output: kind === 'data' ? output : undefined, input: kind === 'data' ? input : undefined, onFailure });
                this.render();
                Toast.success('Connection updated');
            } catch (error) { Toast.error(error instanceof Error ? error.message : 'Invalid connection'); }
        });
        inspector.querySelector('[data-edge-delete]')?.addEventListener('click', () => {
            this.controller?.deleteEdge(edge.id);
            this.selectedEdgeId = undefined;
            this.render();
        });
    }

    private renderFlowOverview(draft: FlowDraft): string {
        const defaults = isRecord(draft.defaults) ? draft.defaults : {};
        const parameterRequired = (draft.parameters ?? []).filter(parameter => parameter.required && parameter.default === undefined).length;
        const defaultLabels = [
            typeof defaults.agentId === 'string' && defaults.agentId ? `Agent: ${defaults.agentId}` : 'Session Agent',
            typeof defaults.systemPromptId === 'string' && defaults.systemPromptId ? `Prompt: ${defaults.systemPromptId}` : '',
            `${Array.isArray(defaults.toolIds) ? defaults.toolIds.length : 0} tools`,
            `${Array.isArray(defaults.skillIds) ? defaults.skillIds.length : 0} skills`,
        ].filter(Boolean);
        return `<section class="dag-inspector__overview">
            <h3 style="margin-bottom:.25rem">${escapeHTML(draft.name)}</h3>
            <small>${draft.nodes.length} nodes · ${draft.edges.length} edges</small>
            <h4>Flow defaults</h4>
            <p>${defaultLabels.map(label => `<span class="dag-badge">${escapeHTML(label)}</span>`).join(' ')}</p>
            <h4>Run inputs</h4>
            <p>${draft.parameters?.length ?? 0} parameters${parameterRequired ? ` · ${parameterRequired} required` : ''}</p>
            <h4>Connections</h4>
            <p>${draft.connections?.length ?? 0} slots · default: ${escapeHTML(draft.defaultConnection ?? draft.connections?.[0]?.name ?? 'Session')}</p>
            <button data-inspector-settings><i class="fas fa-sliders-h"></i> Edit Flow settings</button>
        </section>`;
    }

    private renderEdgeList(draft: FlowDraft, nodeId?: FlowNodeId): string {
        const edges = nodeId
            ? draft.edges.filter(edge => edge.from === nodeId || edge.to === nodeId)
            : draft.edges;
        return `<h4>Edges</h4><div class="dag-edge-list">${edges.map(edge =>
            `<div><span>${escapeHTML(`${edge.from} → ${edge.to}`)}</span><small>${edge.kind}</small>
            <button data-edit-edge="${escapeHTML(String(edge.id))}">Edit</button>
            <button data-delete-edge="${escapeHTML(String(edge.id))}">×</button></div>`,
        ).join('') || '<p>No edges</p>'}</div>`;
    }

    private bindToolbar(): void {
        this.root.querySelector<HTMLSelectElement>('[data-action="add-kind"]')
            ?.addEventListener('change', event => {
                const select = event.currentTarget as HTMLSelectElement;
                const presentation = this.catalogue[Number(select.value)];
                if (presentation) void this.addNode(presentation.manifest);
            });
        const actions: Record<string, () => void> = {
            undo: () => this.changeHistory('undo'),
            redo: () => this.changeHistory('redo'),
            layout: () => this.autoLayout(),
            'zoom-out': () => this.zoom(-0.1),
            'zoom-in': () => this.zoom(0.1),
            fit: () => this.fitCanvas(),
            settings: () => void this.openFlowSettings(),
            save: () => void this.save(),
            publish: () => void this.publish(),
            run: () => void this.prepareRun(),
        };
        for (const [action, callback] of Object.entries(actions)) {
            this.root.querySelector(`[data-action="${action}"]`)?.addEventListener('click', callback);
        }
    }

    private bindEdgeActions(root: HTMLElement): void {
        root.querySelectorAll<HTMLElement>('[data-edit-edge]').forEach(button => {
            button.addEventListener('click', () => this.selectEdge(button.dataset.editEdge!));
        });
        root.querySelectorAll<HTMLElement>('[data-delete-edge]').forEach(button => {
            button.addEventListener('click', () => {
                this.controller?.deleteEdge(button.dataset.deleteEdge as never);
                this.render();
            });
        });
    }

    private async confirmDeleteNode(nodeId: FlowNodeId): Promise<void> {
        const incident = this.controller?.value.edges.filter(edge =>
            edge.from === nodeId || edge.to === nodeId,
        ).length ?? 0;
        if (!await showConfirmDialog(`Delete this node and ${incident} incident edge(s)?`)) return;
        this.controller?.deleteNode(nodeId);
        this.selectedNodeId = undefined;
        this.render();
    }

    private async openNodeEditor(nodeId: FlowNodeId): Promise<void> {
        const node = this.controller?.value.nodes.find(item => item.id === nodeId);
        const presentation = node && this.findPresentation(node);
        if (!node || !presentation) return;
        const dialog = this.createNodeDialog(node);
        const formRoot = dialog.querySelector<HTMLElement>('[data-config-form]')!;
        const formValue = node.plugin === 'builtin.agent' ? canonicalAgentConfig(node.config) : node.config;
        let schema = this.controller
            ? withConnectionEnum(presentation.manifest.configSchema, this.controller.value, formValue)
            : presentation.manifest.configSchema;
        if (node.plugin === 'builtin.agent') {
            const [agents, prompts, tools, skills] = await Promise.all([
                this.options.listAgents?.() ?? Promise.resolve([]),
                this.options.listSystemPrompts?.() ?? Promise.resolve([]),
                this.options.listTools?.() ?? Promise.resolve([]),
                this.options.listSkills?.() ?? Promise.resolve([]),
            ]);
            schema = withAgentEntityEnums(schema, formValue, { agents, prompts, tools, skills });
        } else if (node.plugin === 'builtin.flow') {
            const flows = await this.options.commands.execute<FlowDraft[]>(FlowCommand.DraftList);
            schema = withCompositeFlowEnum(schema, formValue, flows);
        }
        const schemaForm = new SchemaForm(
            formRoot,
            schema,
            formValue,
            presentation.ui?.inspector.layout,
        );
        schemaForm.render();
        if (node.plugin === 'builtin.spawn') enhanceSpawnForm(formRoot);
        this.bindNodeDialog(dialog, node, schemaForm);
    }

    private createNodeDialog(node: FlowNodeDefinition): HTMLDialogElement {
        const dialog = document.createElement('dialog');
        dialog.className = 'dag-dialog';
        dialog.innerHTML = `<form method="dialog">
            <h2>Edit ${escapeHTML(node.name)}</h2>
            <label>Name <input name="name" value="${escapeHTML(node.name)}" required></label>
            <div data-config-form></div>
            <details><summary>Scheduling (JSON)</summary>
                <label>Static inputs<textarea name="inputs">${escapeHTML(JSON.stringify(node.inputs, null, 2))}</textarea></label>
                <label>Capabilities<textarea name="capabilities">${escapeHTML(JSON.stringify(node.capabilities ?? [], null, 2))}</textarea></label>
                <label>Budget<textarea name="budget">${escapeHTML(JSON.stringify(node.budget ?? {}, null, 2))}</textarea></label>
                <label>Priority <input name="priority" type="number" value="${node.priority ?? 0}"></label>
            </details>
            <p data-dialog-error class="dag-dialog__error"></p>
            <menu><button value="cancel">Cancel</button><button value="save">Save node</button></menu>
        </form>`;
        document.body.append(dialog);
        dialog.showModal();
        return dialog;
    }

    private bindNodeDialog(dialog: HTMLDialogElement, node: FlowNodeDefinition, form: SchemaForm): void {
        dialog.addEventListener('close', () => {
            if (dialog.returnValue === 'save') {
                const updated = this.readNodeDialog(dialog, node, form);
                if (!updated) {
                    dialog.showModal();
                    return;
                }
                this.controller?.updateNode(updated);
                this.render();
            }
            dialog.remove();
        });
    }

    private readNodeDialog(
        dialog: HTMLDialogElement,
        node: FlowNodeDefinition,
        schemaForm: SchemaForm,
    ): FlowNodeDefinition | null {
        try {
            const config = schemaForm.read();
            if (config.errors.length || config.value === undefined) throw new Error(config.errors.join('; '));
            const field = (name: string) => dialog.querySelector<HTMLTextAreaElement | HTMLInputElement>(`[name="${name}"]`)!.value;
            return {
                ...node,
                name: field('name').trim(),
                config: node.plugin === 'builtin.agent' ? canonicalAgentConfig(config.value) : config.value,
                inputs: JSON.parse(field('inputs')),
                capabilities: JSON.parse(field('capabilities')),
                budget: JSON.parse(field('budget')),
                priority: Number(field('priority')),
            };
        } catch (error) {
            dialog.querySelector<HTMLElement>('[data-dialog-error]')!.textContent =
                error instanceof Error ? error.message : 'Invalid node settings';
            return null;
        }
    }

    private async save(): Promise<FlowDraft | null> {
        if (!this.controller) return null;
        const draft = this.controller.value;
        try {
            const result = await this.options.commands.execute<{ draft: FlowDraft }>(FlowCommand.DraftSave, {
                draft,
                expectedDraftVersion: draft.draftVersion,
            });
            this.controller.replace(result.draft);
            this.render();
            Toast.success(`Saved draft v${result.draft.draftVersion}`);
            return result.draft;
        } catch (error) {
            Toast.error(`${error instanceof Error ? error.message : 'Save failed'}. Local changes were kept.`);
            return null;
        }
    }

    private async publish(): Promise<FlowRevision | null> {
        const saved = await this.save();
        if (!saved) return null;
        try {
            const result = await this.options.commands.execute<{ revision: FlowRevision }>(FlowCommand.RevisionCreate, {
                draftId: saved.id,
                expectedDraftVersion: saved.draftVersion,
            });
            Toast.success(`Published revision ${result.revision.revision}`);
            return result.revision;
        } catch (error) {
            Toast.error(error instanceof Error ? error.message : 'Publish failed');
            return null;
        }
    }

    private async prepareRun(): Promise<void> {
        const revision = await this.publish();
        if (!revision) return;
        this.options.onSelectFlow?.(String(revision.id), revision.revision);
        Toast.success(`Flow r${revision.revision} selected. Send a message to run it.`);
    }

    private async refreshValidation(draft: FlowDraft): Promise<void> {
        const target = this.root.querySelector<HTMLElement>('.dag-validation');
        if (!target) return;
        try {
            const result = await this.options.commands.execute<{ valid: boolean; validationIssues: Array<{ message: string }> }>(FlowCommand.DraftValidate, draft);
            target.classList.toggle('has-errors', !result.valid);
            target.innerHTML = result.validationIssues.map(issue => `<span>${escapeHTML(issue.message)}</span>`).join('')
                || '<span>Flow is valid</span>';
        } catch (error) {
            target.textContent = error instanceof Error ? error.message : 'Validation failed';
        }
    }

    private renderRun(): void {
        const snapshot = this.run;
        if (!snapshot) return this.renderDesign();
        const run = snapshot.root.task;
        const nodeSnapshots = new Map(snapshot.nodes.map(item => [item.snapshot.task.id, item.snapshot]));
        this.root.innerHTML = `<section class="dag-workbench" data-mode="run">
            <header class="dag-toolbar"><strong>DAG Run</strong><span>${escapeHTML(String(run.id))}</span><span data-status="${escapeHTML(run.status)}">${escapeHTML(run.status)}</span><small>${snapshot.usage.tokens} tokens · ${(snapshot.usage.elapsedMs / 1000).toFixed(1)}s</small><button data-run-action="goal">Goal</button><button data-run-action="cancel">Cancel run</button></header>
            ${snapshot.goal ? `<section class="dag-run-goal"><strong>${escapeHTML(snapshot.goal.objective || 'Run goal')}</strong><span>${escapeHTML(snapshot.goal.status ?? 'active')}</span>${snapshot.goal.acceptanceCriteria?.length ? `<small>${snapshot.goal.acceptanceCriteria.map(escapeHTML).join(' · ')}</small>` : ''}</section>` : ''}
            <div class="dag-run-nodes">${snapshot.taskTree.map(task => {
                const nodeId = task.labels?.flowNodeId ?? (task.id === run.id ? 'Result' : task.program.kind);
                const iterations = snapshot.iterations[nodeId] ?? 1;
                const waiting = pendingInteraction(nodeSnapshots.get(task.id));
                const detached = snapshot.detachedNodes.includes(nodeId);
                return `<article data-task-id="${escapeHTML(task.id)}">
                    <header><strong>${escapeHTML(nodeId)}</strong><small>${escapeHTML(task.status)}${iterations > 1 ? ` · ×${iterations}` : ''}${detached ? ' · detached' : ''}</small></header>
                    <div>${escapeHTML(task.program.kind)} · attempt ${task.attemptCount}</div>
                    ${task.parentTaskId ? `<small>parent: ${escapeHTML(task.parentTaskId)}</small>` : ''}
                    ${task.lastError?.message ? `<div class="dag-run-error">${escapeHTML(task.lastError.message)}</div>` : ''}
                    ${waiting ? `<div class="dag-run-wait">${escapeHTML(waiting.prompt)}</div><button data-run-respond="${escapeHTML(nodeId)}" data-request-id="${escapeHTML(waiting.id)}">Respond</button>` : ''}
                    ${task.id !== run.id && !isTerminalRun(task.status) ? `<menu><button data-run-signal="${escapeHTML(task.id)}">Inject</button><button data-run-cancel-task="${escapeHTML(task.id)}">Cancel</button></menu>` : ''}
                    <details><summary>Runtime details</summary><pre>${escapeHTML(JSON.stringify({ wait: task.wait, output: task.output, effects: Object.keys(task.effects ?? {}) }, null, 2))}</pre></details>
                </article>`;
            }).join('')}</div>
        </section>`;
        this.root.querySelector('[data-run-action="cancel"]')?.addEventListener('click', () => void this.cancel());
        this.root.querySelector('[data-run-action="goal"]')?.addEventListener('click', () => this.openGoalDialog());
        this.root.querySelectorAll<HTMLElement>('[data-run-signal]').forEach(button => button.addEventListener('click', () => this.openSignalDialog(button.dataset.runSignal!)));
        this.root.querySelectorAll<HTMLElement>('[data-run-cancel-task]').forEach(button => button.addEventListener('click', () => void this.cancelRunTask(button.dataset.runCancelTask!)));
        this.root.querySelectorAll<HTMLElement>('[data-run-respond]').forEach(button => {
            button.addEventListener('click', () => {
                const nodeId = button.dataset.runRespond!;
                const requestId = button.dataset.requestId!;
                const waiting = pendingInteraction(
                    this.run?.nodes.find(item => item.nodeId === nodeId)?.snapshot,
                );
                this.openRespondDialog(nodeId, requestId, waiting?.prompt ?? 'Please respond.');
            });
        });
    }

    private openGoalDialog(): void {
        if (!this.run) return;
        const dialog = document.createElement('dialog');
        dialog.className = 'dag-dialog';
        dialog.innerHTML = `<form method="dialog"><h2>Run goal</h2><label>Objective<textarea name="objective" rows="3">${escapeHTML(this.run.goal?.objective ?? '')}</textarea></label><label>Status<select name="status">${['active', 'paused', 'completed', 'blocked'].map(status => `<option ${status === (this.run?.goal?.status ?? 'active') ? 'selected' : ''}>${status}</option>`).join('')}</select></label><menu><button value="cancel">Cancel</button><button value="save">Save</button></menu></form>`;
        document.body.append(dialog); dialog.showModal();
        dialog.addEventListener('close', () => {
            if (dialog.returnValue === 'save' && this.run) {
                const objective = dialog.querySelector<HTMLTextAreaElement>('[name="objective"]')!.value.trim();
                const status = dialog.querySelector<HTMLSelectElement>('[name="status"]')!.value;
                void this.options.commands.execute(FlowCommand.RunGoalUpdate, { taskId: this.run.root.task.id, goal: { objective, status } })
                    .then(() => this.refreshRun(this.run!.root.task.id));
            }
            dialog.remove();
        }, { once: true });
    }

    private openSignalDialog(targetTaskId: string): void {
        const value = window.prompt('Inject a message or control payload into this task:');
        if (value === null || !this.run) return;
        void this.options.commands.execute(FlowCommand.RunSignal, {
            taskId: this.run.root.task.id, targetTaskId, signal: { type: 'inject', payload: value },
        }).then(() => this.refreshRun(this.run!.root.task.id));
    }

    private async cancelRunTask(targetTaskId: string): Promise<void> {
        if (!this.run) return;
        await this.options.commands.execute(FlowCommand.RunTaskCancel, { taskId: this.run.root.task.id, targetTaskId });
        await this.refreshRun(this.run.root.task.id);
    }

    private openRespondDialog(nodeId: string, requestId: string, prompt: string): void {
        const dialog = document.createElement('dialog');
        dialog.className = 'dag-dialog';
        dialog.innerHTML = `<form method="dialog"><h2>Respond to ${escapeHTML(nodeId)}</h2>
            <p>${escapeHTML(prompt)}</p>
            <label>Response<textarea name="value" rows="3"></textarea></label>
            <menu><button value="cancel">Cancel</button><button value="respond">Respond</button></menu></form>`;
        document.body.append(dialog);
        dialog.showModal();
        dialog.addEventListener('close', () => {
            if (dialog.returnValue === 'respond') {
                const value = dialog.querySelector<HTMLTextAreaElement>('[name="value"]')!.value;
                void this.options.commands.execute(FlowCommand.RunRespond, {
                    taskId: this.run?.root.task.id,
                    requestId,
                    value,
                }).then(() => {
                    if (this.run) void this.refreshRun(this.run.root.task.id);
                }).catch(error => {
                    Toast.error(error instanceof Error ? error.message : 'Respond failed');
                });
            }
            dialog.remove();
        }, { once: true });
    }

    private scheduleRunRefresh(taskId: string): void {
        this.stopRunRefresh();
        if (!this.run || isTerminalRun(this.run.root.task.status)) return;
        this.runRefreshTimer = setTimeout(() => {
            void this.refreshRun(taskId);
        }, 1000);
    }

    private async refreshRun(taskId: string): Promise<void> {
        try {
            this.run = await this.options.commands.execute<DurableFlowSnapshot>(FlowCommand.RunGet, {
                taskId,
            });
            if (this.mode === 'run') this.render();
            this.scheduleRunRefresh(taskId);
        } catch {
            this.stopRunRefresh();
        }
    }

    private stopRunRefresh(): void {
        if (this.runRefreshTimer) clearTimeout(this.runRefreshTimer);
        this.runRefreshTimer = undefined;
    }

    private selectNode(id: FlowNodeId): void {
        this.selectedNodeId = id;
        this.selectedEdgeId = undefined;
        this.render();
    }

    private selectEdge(id: string): void {
        this.selectedNodeId = undefined;
        this.selectedEdgeId = id;
        this.render();
    }

    private selectCanvas(): void {
        if (!this.selectedNodeId && !this.selectedEdgeId) return;
        this.selectedNodeId = undefined;
        this.selectedEdgeId = undefined;
        this.render();
    }

    private moveNode(id: FlowNodeId, position: { x: number; y: number }): void {
        this.controller?.moveNode(id, position);
        this.render();
    }

    private connectNodes(from: FlowNodeDefinition, to: FlowNodeDefinition): void {
        try {
            const source = this.findDescriptor(from);
            const target = this.findDescriptor(to);
            const output = source?.outputs[0]?.name;
            const input = target?.inputs[0]?.name;
            const kind = output && input ? 'data' : 'control';
            const edge = createFlowEdge(from, to, kind, { output, input });
            this.controller?.addEdge(edge);
            this.wireRouteBranch(from, to, edge.id);
            this.render();
        } catch (error) {
            Toast.error(error instanceof Error ? error.message : 'Unable to connect nodes');
        }
    }

    /** When wiring a route node, register the new edge id so the branch actually activates. */
    private wireRouteBranch(from: FlowNodeDefinition, to: FlowNodeDefinition, edgeId: string): void {
        if (from.plugin !== 'builtin.route') return;
        const config: Record<string, unknown> = isRecord(from.config)
            ? { ...from.config } as Record<string, unknown>
            : {};
        if (!config.defaultEdgeId) {
            // First branch doubles as the fallback default.
            config.defaultEdgeId = edgeId;
        } else {
            const rules = Array.isArray(config.rules) ? config.rules.filter(isRecord) : [];
            if (!rules.some(rule => String(rule.edgeId) === edgeId)) {
                rules.push({
                    edgeId,
                    // Seed an eq rule against the target node id; refine the JSON
                    // expression for real routing conditions.
                    expression: { kind: 'eq', args: [{ kind: 'path', path: ['input'] }, { kind: 'literal', value: to.id }] },
                });
            }
            config.rules = rules;
        }
        this.controller?.updateNode({ ...from, config: config as unknown as FlowNodeDefinition['config'] });
    }

    private changeHistory(direction: 'undo' | 'redo'): void {
        this.controller?.[direction]();
        this.render();
    }

    private autoLayout(): void {
        this.controller?.applyAutoLayout();
        this.render();
    }

    private zoom(delta: number): void {
        if (!this.controller) return;
        const current = this.controller.value.layout.viewport?.zoom ?? 1;
        this.controller.setZoom(current + delta);
        this.render();
    }

    private fitCanvas(): void {
        this.controller?.setZoom(1);
        this.render();
        this.canvas?.fit();
    }

    private async openFlowSettings(): Promise<void> {
        const controller = this.controller;
        if (!controller) return;
        const draft = controller.value;
        const [availableConnections, agents, systemPrompts, tools, skills] = await Promise.all([
            this.options.listConnections?.() ?? Promise.resolve([]),
            this.options.listAgents?.() ?? Promise.resolve([]),
            this.options.listSystemPrompts?.() ?? Promise.resolve([]),
            this.options.listTools?.() ?? Promise.resolve([]),
            this.options.listSkills?.() ?? Promise.resolve([]),
        ]);
        const result = await openFlowSettings({
            connections: draft.connections ?? [],
            defaultConnection: draft.defaultConnection,
            parameters: draft.parameters ?? [],
            availableConnections,
            defaults: draft.defaults,
            runPolicy: draft.runPolicy,
            agents,
            systemPrompts,
            tools,
            skills,
        });
        if (!result) return;
        controller.updateFlowSettings(result);
        this.render();
        void this.refreshValidation(controller.value);
    }

    private findDescriptor(node: FlowNodeDefinition): DagPluginManifest | undefined {
        return this.findPresentation(node)?.manifest;
    }

    private findPresentation(node: FlowNodeDefinition): DagPluginPresentation | undefined {
        return this.catalogue.find(item =>
            item.manifest.id === node.plugin
            && item.manifest.version === node.pluginVersion,
        );
    }

    private setMode(mode: 'design' | 'run'): void {
        this.mode = mode;
        this.options.onModeChange?.(mode);
        this.render();
    }
}

function paletteLabel(presentation: DagPluginPresentation): string {
    return presentation.ui?.palette.label ?? presentation.manifest.title;
}

function isTerminalRun(status: TaskStatus): boolean {
    return ['succeeded', 'failed', 'cancelled'].includes(status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Normalize legacy Agent fields when the user next edits the node. */
function canonicalAgentConfig(value: JsonValue): JsonValue {
    if (!isRecord(value)) return value;
    const result = structuredClone(value) as Record<string, JsonValue>;
    if (typeof result.instruction !== 'string' && typeof result.prompt === 'string') {
        result.instruction = result.prompt;
    }
    delete result.prompt;
    if (isRecord(result.delegation) && isRecord(result.delegation.template)) {
        const template = result.delegation.template;
        if (typeof template.instruction !== 'string' && typeof template.prompt === 'string') {
            template.instruction = template.prompt;
        }
        delete template.prompt;
    }
    return result;
}

/** Turn `config.connectionId` into a dropdown of the flow's connection slots (+ inherit). */
function withConnectionEnum(
    schema: JsonValue,
    flow: FlowDraft,
    nodeConfig: FlowNodeDefinition['config'],
): JsonValue {
    if (!isRecord(schema)) return schema;
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const connectionField = isRecord(properties.connectionId) ? properties.connectionId : undefined;
    if (!connectionField) return schema;
    const aliases = (flow.connections ?? []).map(connection => connection.name);
    const current = isRecord(nodeConfig) ? nodeConfig.connectionId : undefined;
    const enumValues: JsonValue[] = [...aliases];
    if (typeof current === 'string' && current && !aliases.includes(current)) enumValues.push(current);
    return {
        ...schema,
        properties: {
            ...properties,
            connectionId: { ...connectionField, enum: enumValues },
        },
    } as JsonValue;
}

function withAgentEntityEnums(
    schema: JsonValue,
    config: FlowNodeDefinition['config'],
    entities: { agents: EntityOption[]; prompts: EntityOption[]; tools: EntityOption[]; skills: EntityOption[] },
): JsonValue {
    if (!isRecord(schema) || !isRecord(schema.properties)) return schema;
    const properties = { ...schema.properties } as Record<string, JsonValue>;
    const current = isRecord(config) ? config : {};
    if (!isRecord(current.subtasks)) delete properties.subtasks;
    const decorateRef = (key: string, values: EntityOption[], title: string, description: string) => {
        const original = isRecord(properties[key]) ? properties[key] : {};
        const currentId = typeof current[key] === 'string' ? current[key] : '';
        const ids = values.map(item => item.id);
        if (currentId && !ids.includes(currentId)) ids.unshift(currentId);
        properties[key] = {
            ...original,
            title,
            description,
            enum: ids,
        } as JsonValue;
    };
    const decorateMany = (key: string, values: EntityOption[], title: string, description: string) => {
        const original = isRecord(properties[key]) ? properties[key] : {};
        const ids = values.map(item => item.id);
        for (const id of Array.isArray(current[key]) ? current[key].map(String) : []) {
            if (!ids.includes(id)) ids.unshift(id);
        }
        properties[key] = {
            ...original,
            title,
            description,
            items: { type: 'string', enum: ids },
        } as JsonValue;
    };
    decorateRef('agentId', entities.agents, 'Agent', '可选；继承该 Agent 的模型、身份和能力，节点显式值优先。');
    decorateRef('systemPromptId', entities.prompts, 'System Prompt', '引用提示词库；按策略追加或替换默认提示词。');
    decorateMany('toolIds', entities.tools, 'Tools', '与 Flow、Agent 和节点 capabilities 的工具取并集。');
    decorateMany('skillIds', entities.skills, 'Skills', '在该节点静态加载的 Skills。');
    // Reuse the same entity catalogs inside the structured delegation template.
    const delegationField = isRecord(properties.delegation) ? properties.delegation : undefined;
    const delegationProperties = delegationField && isRecord(delegationField.properties)
        ? { ...delegationField.properties } as Record<string, JsonValue>
        : undefined;
    const templateField = delegationProperties && isRecord(delegationProperties.template)
        ? delegationProperties.template
        : undefined;
    const templateProperties = templateField && isRecord(templateField.properties)
        ? { ...templateField.properties } as Record<string, JsonValue>
        : undefined;
    if (delegationProperties && templateField && templateProperties) {
        const delegationCurrent = isRecord(current.delegation) ? current.delegation : {};
        const templateCurrent = isRecord(delegationCurrent.template) ? delegationCurrent.template : {};
        const ref = (key: string, values: EntityOption[]) => {
            if (!isRecord(templateProperties[key])) return;
            const ids = values.map(item => item.id);
            const selected = typeof templateCurrent[key] === 'string' ? templateCurrent[key] : '';
            if (selected && !ids.includes(selected)) ids.unshift(selected);
            templateProperties[key] = { ...templateProperties[key], enum: ids } as JsonValue;
        };
        const many = (key: string, values: EntityOption[]) => {
            if (!isRecord(templateProperties[key])) return;
            const ids = values.map(item => item.id);
            for (const id of Array.isArray(templateCurrent[key]) ? templateCurrent[key].map(String) : []) {
                if (!ids.includes(id)) ids.unshift(id);
            }
            templateProperties[key] = { ...templateProperties[key], items: { type: 'string', enum: ids } } as JsonValue;
        };
        ref('agentId', entities.agents);
        ref('systemPromptId', entities.prompts);
        many('toolIds', entities.tools);
        many('skillIds', entities.skills);
        if (isRecord(properties.connectionId) && Array.isArray(properties.connectionId.enum) && isRecord(templateProperties.connectionId)) {
            templateProperties.connectionId = { ...templateProperties.connectionId, enum: properties.connectionId.enum } as JsonValue;
        }
        delegationProperties.template = { ...templateField, properties: templateProperties } as JsonValue;
        properties.delegation = { ...delegationField, properties: delegationProperties } as JsonValue;
    }
    const labels: Record<string, [string, string]> = {
        instruction: ['节点任务指令', '作为节点本地 system 指令追加。可使用 ${params.name}。'],
        historyPolicy: ['对话上下文', 'inherit=会话历史，upstream=仅上游，none=隔离。'],
        systemPromptPolicy: ['System Prompt 策略', 'inherit=继承并追加，replace=仅节点，none=完全禁用。'],
        persistOutput: ['输出写入会话', '关闭时仍传递给下游，但不进入最终会话历史。'],
        connectionId: ['Connection Slot', '留空时继承 Flow 默认连接。'],
    };
    for (const [key, [title, description]] of Object.entries(labels)) {
        if (!isRecord(properties[key])) continue;
        properties[key] = { ...properties[key], title, description } as JsonValue;
    }
    return { ...schema, properties } as JsonValue;
}

function withCompositeFlowEnum(schema: JsonValue, config: JsonValue, flows: FlowDraft[]): JsonValue {
    if (!isRecord(schema) || !isRecord(schema.properties) || !isRecord(schema.properties.flowId)) return schema;
    const selected = isRecord(config) && typeof config.flowId === 'string' ? config.flowId : '';
    const ids = flows.map(flow => String(flow.id));
    if (selected && !ids.includes(selected)) ids.unshift(selected);
    return {
        ...schema,
        properties: {
            ...schema.properties,
            flowId: {
                ...schema.properties.flowId,
                enum: ids,
                description: '复用已发布 Flow；运行前展开为同一个 DAG，不创建第二套调度器。',
            },
        },
    } as JsonValue;
}

function pendingInteraction(
    snapshot: TaskSnapshot | undefined,
): { id: string; prompt: string } | undefined {
    if (!snapshot) return undefined;
    for (const interaction of Object.values(snapshot.task.interactions ?? {})) {
        if (interaction.status === 'pending') {
            return { id: interaction.id, prompt: interaction.prompt };
        }
    }
    return undefined;
}

function portOptions(
    ports: Array<{ name: string }> | undefined,
    selected: string | undefined,
): string {
    const names = (ports ?? []).map(port => port.name);
    if (selected && !names.includes(selected)) names.unshift(selected);
    if (!names.length) names.push(selected || 'result');
    return names.map(name => `<option value="${escapeHTML(name)}" ${name === selected ? 'selected' : ''}>${escapeHTML(name)}</option>`).join('');
}

function enhanceSpawnForm(root: HTMLElement): void {
    const nodes = root.querySelector<HTMLTextAreaElement>('[data-schema-path="$.spawn.nodes"]');
    const edges = root.querySelector<HTMLTextAreaElement>('[data-schema-path="$.spawn.edges"]');
    if (!nodes || !edges) return;
    const toolbar = document.createElement('div');
    toolbar.className = 'dag-spawn-actions';
    toolbar.innerHTML = `<button type="button" data-add-spawn-agent><i class="fas fa-plus"></i> Add Agent template</button><button type="button" data-add-spawn-edge><i class="fas fa-link"></i> Add connection template</button>`;
    nodes.closest('.dag-schema-object')?.querySelector(':scope > summary')?.insertAdjacentElement('afterend', toolbar);
    toolbar.querySelector('[data-add-spawn-agent]')?.addEventListener('click', () => {
        const current = parseJsonArray(nodes.value);
        if (!current) return;
        const id = `spawned-${current.length + 1}`;
        current.push({
            id, name: `Spawned Agent ${current.length + 1}`, plugin: 'builtin.agent', pluginVersion: '1.0.0',
            config: { instruction: '', historyPolicy: 'upstream', approval: 'external' }, inputs: {}, capabilities: [],
        });
        nodes.value = JSON.stringify(current, null, 2);
    });
    toolbar.querySelector('[data-add-spawn-edge]')?.addEventListener('click', () => {
        const current = parseJsonArray(edges.value);
        if (!current) return;
        current.push({ id: `spawn-edge-${current.length + 1}`, from: '', to: '', output: 'result', input: 'input' });
        edges.value = JSON.stringify(current, null, 2);
    });
}

function parseJsonArray(value: string): Array<Record<string, unknown>> | null {
    try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed.filter(isRecord) : [];
    } catch {
        Toast.error('Fix the current JSON before adding a template');
        return null;
    }
}
