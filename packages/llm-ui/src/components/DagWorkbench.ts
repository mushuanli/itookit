import type {
    FlowDraft,
    FlowNodeId,
    FlowRevision,
    ICommandBus,
    FlowEdgeDefinition,
    DagPluginManifest,
    DagPluginPresentation,
    FlowNodeDefinition,
} from '@itookit/common';
import type { DurableFlowSnapshot } from '@itookit/llm-session';
import { FlowCommand } from '@itookit/llm-session';
import type { TaskSnapshot, TaskStatus } from '@itookit/durable-kernel';
import {escapeHTML} from '@itookit/common';
import { showConfirmDialog, Toast } from '@itookit/ui-common';
import { DagDraftController, createFlowEdge } from './dag/DagDraftController';
import { SchemaForm } from './dag/SchemaForm';
import { DagCanvas } from './dag/DagCanvas';

export interface DagWorkbenchOptions {
    commands: ICommandBus;
    onModeChange?: (mode: 'design' | 'run') => void;
    onSelectFlow?: (flowId: string, revision: number) => void;
}

export class DagWorkbench {
    private mode: 'design' | 'run' = 'design';
    private controller: DagDraftController | null = null;
    private run: DurableFlowSnapshot | null = null;
    private catalogue: DagPluginPresentation[] = [];
    private selectedNodeId?: FlowNodeId;
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
        this.render();
        this.openNodeEditor(node.id);
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
        this.canvas = new DagCanvas(root, {
            onSelectNode: id => this.selectNode(id),
            onMoveNode: (id, position) => this.moveNode(id, position),
            onConnect: (from, to) => this.connectNodes(from, to),
        });
        this.canvas.render(draft, this.selectedNodeId);
    }

    private renderInspector(draft: FlowDraft): void {
        const inspector = this.root.querySelector<HTMLElement>('.dag-inspector')!;
        const node = draft.nodes.find(item => item.id === this.selectedNodeId);
        if (!node) {
            inspector.innerHTML = this.renderEdgeList(draft);
            this.bindEdgeActions(inspector);
            return;
        }
        const summary = pluginSummary(this.findPresentation(node), node.config);
        inspector.innerHTML = `<h3>${escapeHTML(node.name)}</h3>
            <small>${escapeHTML(node.plugin)} · ${escapeHTML(node.id)}</small>
            ${summary ? `<p>${escapeHTML(summary)}</p>` : ''}
            <div class="dag-inspector__actions">
                <button data-node-action="edit">Edit</button>
                <button data-node-action="duplicate">Duplicate</button>
                <button data-node-action="delete">Delete</button>
            </div>${this.renderEdgeList(draft, node.id)}`;
        this.bindNodeActions(inspector, node.id);
        this.bindEdgeActions(inspector);
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
            save: () => void this.save(),
            publish: () => void this.publish(),
            run: () => void this.prepareRun(),
        };
        for (const [action, callback] of Object.entries(actions)) {
            this.root.querySelector(`[data-action="${action}"]`)?.addEventListener('click', callback);
        }
    }

    private bindNodeActions(root: HTMLElement, nodeId: FlowNodeId): void {
        root.querySelector('[data-node-action="edit"]')?.addEventListener('click', () => this.openNodeEditor(nodeId));
        root.querySelector('[data-node-action="duplicate"]')?.addEventListener('click', () => {
            this.selectedNodeId = this.controller?.duplicateNode(nodeId).id;
            this.render();
        });
        root.querySelector('[data-node-action="delete"]')?.addEventListener('click', () => void this.confirmDeleteNode(nodeId));
    }

    private bindEdgeActions(root: HTMLElement): void {
        root.querySelectorAll<HTMLElement>('[data-edit-edge]').forEach(button => {
            button.addEventListener('click', () => this.openEdgeEditor(button.dataset.editEdge!));
        });
        root.querySelectorAll<HTMLElement>('[data-delete-edge]').forEach(button => {
            button.addEventListener('click', () => {
                this.controller?.deleteEdge(button.dataset.deleteEdge as never);
                this.render();
            });
        });
    }

    private openEdgeEditor(edgeId: string): void {
        const edge = this.controller?.value.edges.find(item => String(item.id) === edgeId);
        if (!edge) return;
        const dialog = document.createElement('dialog');
        dialog.className = 'dag-dialog';
        dialog.innerHTML = `<form method="dialog"><h2>Edit edge</h2>
            <label>Kind<select name="kind"><option ${edge.kind === 'control' ? 'selected' : ''}>control</option><option ${edge.kind === 'data' ? 'selected' : ''}>data</option></select></label>
            <label>Output <input name="output" value="${escapeHTML(edge.output ?? '')}"></label>
            <label>Input <input name="input" value="${escapeHTML(edge.input ?? '')}"></label>
            <p data-dialog-error class="dag-dialog__error"></p>
            <menu><button value="cancel">Cancel</button><button value="save">Save edge</button></menu></form>`;
        document.body.append(dialog);
        dialog.showModal();
        dialog.addEventListener('close', () => this.saveEdgeDialog(dialog, edge), { once: true });
    }

    private saveEdgeDialog(dialog: HTMLDialogElement, edge: FlowEdgeDefinition): void {
        try {
            if (dialog.returnValue !== 'save') return;
            const value = (name: string) =>
                dialog.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)!.value;
            const kind = value('kind') as FlowEdgeDefinition['kind'];
            this.controller?.updateEdge({
                ...edge,
                kind,
                output: kind === 'data' ? value('output') : undefined,
                input: kind === 'data' ? value('input') : undefined,
            });
            this.render();
        } catch (error) {
            Toast.error(error instanceof Error ? error.message : 'Invalid edge');
        } finally {
            dialog.remove();
        }
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

    private openNodeEditor(nodeId: FlowNodeId): void {
        const node = this.controller?.value.nodes.find(item => item.id === nodeId);
        const presentation = node && this.findPresentation(node);
        if (!node || !presentation) return;
        const dialog = this.createNodeDialog(node);
        const formRoot = dialog.querySelector<HTMLElement>('[data-config-form]')!;
        const schemaForm = new SchemaForm(
            formRoot,
            presentation.manifest.configSchema,
            node.config,
            presentation.ui?.inspector.layout,
        );
        schemaForm.render();
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
                config: config.value,
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
        this.root.innerHTML = `<section class="dag-workbench" data-mode="run">
            <header class="dag-toolbar"><strong>DAG Run</strong><span>${escapeHTML(String(run.id))}</span><span data-status="${escapeHTML(run.status)}">${escapeHTML(run.status)}</span><button data-run-action="cancel">Cancel</button></header>
            <div class="dag-run-nodes">${snapshot.nodes.map(({ nodeId, snapshot: node }) => {
                const iterations = snapshot.iterations[nodeId] ?? 1;
                const waiting = pendingInteraction(node);
                return `<article data-task-id="${escapeHTML(node.task.id)}">
                    <strong>${escapeHTML(nodeId)}</strong>
                    <small>${escapeHTML(node.task.status)}${iterations > 1 ? ` · ×${iterations}` : ''}</small>
                    <div>${escapeHTML(node.task.program.kind)}</div>
                    ${waiting ? `<div class="dag-run-wait">${escapeHTML(waiting.prompt)}</div><button data-run-respond="${escapeHTML(nodeId)}" data-request-id="${escapeHTML(waiting.id)}">Respond</button>` : ''}
                </article>`;
            }).join('')}</div>
        </section>`;
        this.root.querySelector('[data-run-action="cancel"]')?.addEventListener('click', () => void this.cancel());
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

function pluginSummary(
    presentation: DagPluginPresentation | undefined,
    config: FlowNodeDefinition['config'],
): string {
    try {
        return presentation?.ui?.node.summarize(config) ?? '';
    } catch {
        return '';
    }
}

function isTerminalRun(status: TaskStatus): boolean {
    return ['succeeded', 'failed', 'cancelled'].includes(status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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
