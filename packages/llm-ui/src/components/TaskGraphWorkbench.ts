import type {
    FlowDraft,
    FlowNodeId,
    FlowRevision,
    ICommandBus,
    TaskGraphRun,
    TaskGraphRunId,
    TaskEdgeDefinition,
    TaskKindDescriptor,
    TaskNodeDefinition,
    TaskRunId,
} from '@itookit/common';
import { escapeHTML, showConfirmDialog, Toast } from '@itookit/common';
import { TaskGraphDraftController, createTaskEdge } from './task-graph/DraftController';
import { SchemaForm } from './task-graph/SchemaForm';
import { TaskGraphCanvas } from './task-graph/TaskGraphCanvas';

export interface TaskGraphWorkbenchOptions {
    commands: ICommandBus;
    onModeChange?: (mode: 'design' | 'run') => void;
    onSelectFlow?: (flowId: string, revision: number) => void;
}

export class TaskGraphWorkbench {
    private mode: 'design' | 'run' = 'design';
    private controller: TaskGraphDraftController | null = null;
    private run: TaskGraphRun | null = null;
    private catalogue: TaskKindDescriptor[] = [];
    private selectedNodeId?: FlowNodeId;
    private canvas?: TaskGraphCanvas;
    private runRefreshTimer?: ReturnType<typeof setTimeout>;

    constructor(
        private readonly root: HTMLElement,
        private readonly options: TaskGraphWorkbenchOptions,
    ) {}

    async initialize(): Promise<void> {
        this.catalogue = await this.options.commands.execute<TaskKindDescriptor[]>('plugin.taskKinds.list');
        this.render();
    }

    setDraft(draft: FlowDraft, selectedNodeId?: FlowNodeId): void {
        this.stopRunRefresh();
        this.controller = new TaskGraphDraftController(draft);
        this.selectedNodeId = selectedNodeId;
        this.setMode('design');
    }

    async loadDraft(id: string, selectedNodeId?: FlowNodeId): Promise<void> {
        const draft = await this.options.commands.execute<FlowDraft | null>('flow.draft.load', { id });
        if (!draft) throw new Error(`Flow draft not found: ${id}`);
        this.setDraft(draft, selectedNodeId);
    }

    async addTask(descriptor: TaskKindDescriptor): Promise<TaskNodeDefinition | null> {
        if (!this.controller) {
            const draft = await this.chooseFlow();
            if (!draft) return null;
            this.setDraft(draft);
        }
        const node = this.controller!.addNode(descriptor);
        this.selectedNodeId = node.id;
        this.render();
        this.openNodeEditor(node.id);
        return node;
    }

    async openRun(graphRunId: TaskGraphRunId): Promise<void> {
        this.run = await this.options.commands.execute<TaskGraphRun>('taskGraph.run.get', { graphRunId });
        this.setMode('run');
        this.scheduleRunRefresh(graphRunId);
    }

    render(): void {
        this.mode === 'design' ? this.renderDesign() : this.renderRun();
    }

    async cancel(): Promise<void> {
        if (!this.run) return;
        await this.options.commands.execute('taskGraph.run.cancel', { graphRunId: this.run.id });
    }

    async retry(taskRunId: TaskRunId): Promise<void> {
        if (!this.run) return;
        await this.options.commands.execute('taskGraph.retryTask', {
            graphRunId: this.run.id,
            taskRunId,
        });
    }

    destroy(): void {
        this.stopRunRefresh();
        this.root.innerHTML = '';
    }

    private renderDesign(): void {
        const draft = this.controller?.value;
        this.root.innerHTML = `<section class="task-graph-workbench" data-mode="design">
            ${this.renderToolbar(draft)}
            <div class="task-graph-workbench__body">
                <div class="task-graph-canvas"></div>
                <aside class="task-graph-inspector"></aside>
            </div>
            <footer class="task-graph-validation" aria-live="polite"></footer>
        </section>`;
        this.bindToolbar();
        if (!draft) return this.renderEmpty();
        this.renderCanvas(draft);
        this.renderInspector(draft);
        void this.refreshValidation(draft);
    }

    private renderToolbar(draft: FlowDraft | undefined): string {
        const addOptions = this.catalogue.map((item, index) =>
            `<option value="${index}">${escapeHTML(`${item.icon ?? ''} ${item.displayName}`)}</option>`,
        ).join('');
        return `<header class="task-graph-toolbar">
            <strong>Flow Design</strong>
            <span>${escapeHTML(draft?.name ?? 'No Flow selected')}</span>
            <button data-action="open-flow">Open Flow</button>
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
        const canvas = this.root.querySelector('.task-graph-canvas');
        if (canvas) canvas.innerHTML = '<p class="task-graph-empty">Choose a Task from Chat Navigator to select or create a Flow.</p>';
    }

    private renderCanvas(draft: FlowDraft): void {
        const root = this.root.querySelector<HTMLElement>('.task-graph-canvas')!;
        this.canvas = new TaskGraphCanvas(root, {
            onSelectNode: id => this.selectNode(id),
            onMoveNode: (id, position) => this.moveNode(id, position),
            onConnect: (from, to) => this.connectNodes(from, to),
        });
        this.canvas.render(draft, this.selectedNodeId);
    }

    private renderInspector(draft: FlowDraft): void {
        const inspector = this.root.querySelector<HTMLElement>('.task-graph-inspector')!;
        const node = draft.nodes.find(item => item.id === this.selectedNodeId);
        if (!node) {
            inspector.innerHTML = this.renderEdgeList(draft);
            this.bindEdgeActions(inspector);
            return;
        }
        inspector.innerHTML = `<h3>${escapeHTML(node.name)}</h3>
            <small>${escapeHTML(node.handler.kind)} · ${escapeHTML(node.id)}</small>
            <div class="task-graph-inspector__actions">
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
        return `<h4>Edges</h4><div class="task-graph-edge-list">${edges.map(edge =>
            `<div><span>${escapeHTML(`${edge.from} → ${edge.to}`)}</span><small>${edge.kind}</small>
            <button data-edit-edge="${escapeHTML(String(edge.id))}">Edit</button>
            <button data-delete-edge="${escapeHTML(String(edge.id))}">×</button></div>`,
        ).join('') || '<p>No edges</p>'}</div>`;
    }

    private bindToolbar(): void {
        this.root.querySelector<HTMLSelectElement>('[data-action="add-kind"]')
            ?.addEventListener('change', event => {
                const select = event.currentTarget as HTMLSelectElement;
                const descriptor = this.catalogue[Number(select.value)];
                if (descriptor) void this.addTask(descriptor);
            });
        const actions: Record<string, () => void> = {
            'open-flow': () => void this.openFlow(),
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
        dialog.className = 'task-graph-dialog';
        dialog.innerHTML = `<form method="dialog"><h2>Edit edge</h2>
            <label>Kind<select name="kind"><option ${edge.kind === 'control' ? 'selected' : ''}>control</option><option ${edge.kind === 'data' ? 'selected' : ''}>data</option></select></label>
            <label>Binding (JSON)<textarea name="binding">${escapeHTML(JSON.stringify(edge.binding ?? {}, null, 2))}</textarea></label>
            <label>Condition (JSON)<textarea name="condition">${escapeHTML(JSON.stringify(edge.condition ?? {}, null, 2))}</textarea></label>
            <p data-dialog-error class="task-graph-dialog__error"></p>
            <menu><button value="cancel">Cancel</button><button value="save">Save edge</button></menu></form>`;
        document.body.append(dialog);
        dialog.showModal();
        dialog.addEventListener('close', () => this.saveEdgeDialog(dialog, edge), { once: true });
    }

    private saveEdgeDialog(dialog: HTMLDialogElement, edge: TaskEdgeDefinition): void {
        try {
            if (dialog.returnValue !== 'save') return;
            const value = (name: string) => dialog.querySelector<HTMLTextAreaElement | HTMLSelectElement>(`[name="${name}"]`)!.value;
            const binding = JSON.parse(value('binding'));
            const condition = JSON.parse(value('condition'));
            this.controller?.updateEdge({
                ...edge,
                kind: value('kind') as TaskEdgeDefinition['kind'],
                binding: Object.keys(binding).length ? binding : undefined,
                condition: Object.keys(condition).length ? condition : undefined,
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
        const descriptor = node && this.findDescriptor(node);
        if (!node || !descriptor) return;
        const dialog = this.createNodeDialog(node);
        const formRoot = dialog.querySelector<HTMLElement>('[data-config-form]')!;
        const schemaForm = new SchemaForm(formRoot, descriptor.configSchema, node.config);
        schemaForm.render();
        this.bindNodeDialog(dialog, node, schemaForm);
    }

    private createNodeDialog(node: TaskNodeDefinition): HTMLDialogElement {
        const dialog = document.createElement('dialog');
        dialog.className = 'task-graph-dialog';
        dialog.innerHTML = `<form method="dialog">
            <h2>Edit ${escapeHTML(node.name)}</h2>
            <label>Name <input name="name" value="${escapeHTML(node.name)}" required></label>
            <div data-config-form></div>
            <details><summary>Ports and policies (JSON)</summary>
                <label>Input ports<textarea name="inputs">${escapeHTML(JSON.stringify(node.inputPorts, null, 2))}</textarea></label>
                <label>Output ports<textarea name="outputs">${escapeHTML(JSON.stringify(node.outputPorts, null, 2))}</textarea></label>
                <label>Join policy<textarea name="join">${escapeHTML(JSON.stringify(node.joinPolicy, null, 2))}</textarea></label>
                <label>Retry policy<textarea name="retry">${escapeHTML(JSON.stringify(node.retryPolicy, null, 2))}</textarea></label>
                <label>Resource policy<textarea name="resource">${escapeHTML(JSON.stringify(node.resourcePolicy ?? {}, null, 2))}</textarea></label>
            </details>
            <p data-dialog-error class="task-graph-dialog__error"></p>
            <menu><button value="cancel">Cancel</button><button value="save">Save node</button></menu>
        </form>`;
        document.body.append(dialog);
        dialog.showModal();
        return dialog;
    }

    private bindNodeDialog(dialog: HTMLDialogElement, node: TaskNodeDefinition, form: SchemaForm): void {
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
        node: TaskNodeDefinition,
        schemaForm: SchemaForm,
    ): TaskNodeDefinition | null {
        try {
            const config = schemaForm.read();
            if (config.errors.length || config.value === undefined) throw new Error(config.errors.join('; '));
            const field = (name: string) => dialog.querySelector<HTMLTextAreaElement | HTMLInputElement>(`[name="${name}"]`)!.value;
            return {
                ...node,
                name: field('name').trim(),
                config: config.value,
                inputPorts: JSON.parse(field('inputs')),
                outputPorts: JSON.parse(field('outputs')),
                joinPolicy: JSON.parse(field('join')),
                retryPolicy: JSON.parse(field('retry')),
                resourcePolicy: JSON.parse(field('resource')),
            };
        } catch (error) {
            dialog.querySelector<HTMLElement>('[data-dialog-error]')!.textContent =
                error instanceof Error ? error.message : 'Invalid node settings';
            return null;
        }
    }

    private async chooseFlow(): Promise<FlowDraft | null> {
        const drafts = await this.options.commands.execute<FlowDraft[]>('flow.draft.list');
        const latest = await Promise.all(drafts.map(draft =>
            this.options.commands.execute<FlowRevision | null>('flow.revision.get', {
                id: draft.id,
            }).catch(() => null),
        ));
        return new Promise(resolve => {
            const dialog = this.createFlowDialog(drafts, latest);
            dialog.addEventListener('close', () => {
                void this.resolveFlowDialog(dialog, drafts).then(resolve);
            }, { once: true });
        });
    }

    private async openFlow(): Promise<void> {
        const draft = await this.chooseFlow();
        if (draft) this.setDraft(draft);
    }

    private createFlowDialog(
        drafts: FlowDraft[],
        latest: Array<FlowRevision | null>,
    ): HTMLDialogElement {
        const dialog = document.createElement('dialog');
        dialog.className = 'task-graph-dialog';
        dialog.innerHTML = `<form method="dialog"><h2>Select Flow</h2>
            <label>Existing Flow<select name="flow"><option value="">Create new…</option>${drafts.map(draft =>
                `<option value="${escapeHTML(String(draft.id))}">${escapeHTML(
                    `${draft.name} · draft v${draft.draftVersion}${latest[drafts.indexOf(draft)] ? ` · latest r${latest[drafts.indexOf(draft)]!.revision}` : ''}`,
                )}</option>`,
            ).join('')}</select></label>
            <label>New Flow ID<input name="id" placeholder="flow-id"></label>
            <label>New Flow name<input name="name" placeholder="Flow name"></label>
            <menu><button value="cancel">Cancel</button><button value="select">Continue</button></menu>
        </form>`;
        document.body.append(dialog);
        dialog.showModal();
        return dialog;
    }

    private async resolveFlowDialog(dialog: HTMLDialogElement, drafts: FlowDraft[]): Promise<FlowDraft | null> {
        try {
            if (dialog.returnValue !== 'select') return null;
            const selected = dialog.querySelector<HTMLSelectElement>('[name="flow"]')!.value;
            if (selected) return drafts.find(draft => String(draft.id) === selected) ?? null;
            const id = dialog.querySelector<HTMLInputElement>('[name="id"]')!.value.trim();
            const name = dialog.querySelector<HTMLInputElement>('[name="name"]')!.value.trim();
            if (!id || !name) throw new Error('Flow ID and name are required');
            return await this.options.commands.execute<FlowDraft>('flow.draft.create', { id, name });
        } catch (error) {
            Toast.error(error instanceof Error ? error.message : 'Unable to select Flow');
            return null;
        } finally {
            dialog.remove();
        }
    }

    private async save(): Promise<FlowDraft | null> {
        if (!this.controller) return null;
        const draft = this.controller.value;
        try {
            const result = await this.options.commands.execute<{ draft: FlowDraft }>('flow.draft.save', {
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
            const result = await this.options.commands.execute<{ revision: FlowRevision }>('flow.revision.create', {
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
        const target = this.root.querySelector<HTMLElement>('.task-graph-validation');
        if (!target) return;
        try {
            const result = await this.options.commands.execute<{ valid: boolean; validationIssues: Array<{ message: string }> }>('flow.draft.validate', draft);
            target.classList.toggle('has-errors', !result.valid);
            target.innerHTML = result.validationIssues.map(issue => `<span>${escapeHTML(issue.message)}</span>`).join('')
                || '<span>Flow is valid</span>';
        } catch (error) {
            target.textContent = error instanceof Error ? error.message : 'Validation failed';
        }
    }

    private renderRun(): void {
        const run = this.run;
        if (!run) return this.renderDesign();
        const tasks = Object.values(run.tasks ?? {});
        this.root.innerHTML = `<section class="task-graph-workbench" data-mode="run">
            <header class="task-graph-toolbar"><strong>TaskGraph Run</strong><span>${escapeHTML(String(run.id))}</span><span data-status="${escapeHTML(run.status)}">${escapeHTML(run.status)}</span><button data-run-action="cancel">Cancel</button></header>
            <div class="task-graph-run-nodes">${tasks.map(task =>
                `<article data-task-run-id="${escapeHTML(String(task.id))}"><strong>${escapeHTML(String(task.spec.sourceNodeId ?? task.id))}</strong><small>${escapeHTML(task.spec.handler.kind)} · ${escapeHTML(task.status)}</small><div>Attempts: ${task.attempts.length}</div><div>Artifacts: ${task.outputArtifactIds.length}</div></article>`,
            ).join('')}</div>
            <div class="task-graph-run-edges">${Object.values(run.edgeStates ?? {}).map(edge =>
                `<div>${escapeHTML(String(edge.edgeId))}: ${escapeHTML(edge.state)} · ${(edge.artifactIds ?? []).length} artifacts</div>`,
            ).join('')}</div>
        </section>`;
        this.root.querySelector('[data-run-action="cancel"]')?.addEventListener('click', () => void this.cancel());
    }

    private scheduleRunRefresh(graphRunId: TaskGraphRunId): void {
        this.stopRunRefresh();
        if (!this.run || isTerminalRun(this.run.status)) return;
        this.runRefreshTimer = setTimeout(() => {
            void this.refreshRun(graphRunId);
        }, 1000);
    }

    private async refreshRun(graphRunId: TaskGraphRunId): Promise<void> {
        try {
            this.run = await this.options.commands.execute<TaskGraphRun>('taskGraph.run.get', {
                graphRunId,
            });
            if (this.mode === 'run') this.render();
            this.scheduleRunRefresh(graphRunId);
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

    private connectNodes(from: TaskNodeDefinition, to: TaskNodeDefinition): void {
        try {
            const kind = from.outputPorts.length && to.inputPorts.length ? 'data' : 'control';
            this.controller?.addEdge(createTaskEdge(from, to, kind));
            this.render();
        } catch (error) {
            Toast.error(error instanceof Error ? error.message : 'Unable to connect nodes');
        }
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

    private findDescriptor(node: TaskNodeDefinition): TaskKindDescriptor | undefined {
        return this.catalogue.find(item =>
            item.handler.kind === node.handler.kind
            && item.handler.provider === node.handler.provider
            && item.handler.version === node.handler.version,
        );
    }

    private setMode(mode: 'design' | 'run'): void {
        this.mode = mode;
        this.options.onModeChange?.(mode);
        this.render();
    }
}

function isTerminalRun(status: TaskGraphRun['status']): boolean {
    return ['succeeded', 'failed', 'cancelled'].includes(status);
}
