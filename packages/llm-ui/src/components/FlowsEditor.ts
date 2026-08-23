// @file: llm-ui/components/FlowsEditor.ts
// Standalone workflow workspace editor: a thin IEditor shell around DagWorkbench.
// Workflows are first-class resources (flows VFS module); running one creates a
// new chat session instance with the declared parameters filled in.

import { IEditor, type EditorFactory, type EditorOptions } from '@itookit/ui-common';
import { NAVIGATION_EVENTS, type FlowDraft, type FlowParameter, type ICommandBus } from '@itookit/common';
import { FlowCommand, SessionCommand } from '@itookit/llm-session';
import { DagWorkbench } from './DagWorkbench';
import { promptFlowParameters } from './FlowParameterForm';

export interface FlowsEditorDeps {
    commands: ICommandBus;
    /** Optional override for the run action (defaults to create-session + navigate). */
    onRunFlow?: (flowId: string, revision: number) => void;
}

export class FlowsEditor extends IEditor {
    private workbench?: DagWorkbench;
    private container?: HTMLElement;

    constructor(
        private readonly deps: FlowsEditorDeps,
        private readonly initialNodeId?: string,
    ) {
        super();
    }

    async init(container: HTMLElement, _initialContent?: string): Promise<void> {
        this.container = container;
        container.innerHTML = '';
        this.workbench = new DagWorkbench(container, {
            commands: this.deps.commands,
            onSelectFlow: (flowId, revision) => void this.handleRunFlow(flowId, revision),
        });
        await this.workbench.initialize();
        // Open the sidebar-selected .flow file if any; otherwise stay on the empty
        // state. We deliberately do NOT auto-invoke pickFlow(): the VFS sidebar
        // re-mounts the editor on every selection/refresh, and auto-prompting
        // there re-opens the "Select Flow" dialog in a loop.
        const flowId = flowIdFromNodeId(this.initialNodeId);
        if (flowId) {
            try {
                const draft = await this.deps.commands.execute<FlowDraft | null>(FlowCommand.DraftLoad, { id: flowId });
                if (!draft) return;
                if (!draft.id) {
                    // Template file created via the VFS "+" button has an empty id;
                    // adopt it into a valid workflow (unique id + file rename).
                    const adopted = await this.deps.commands.execute<FlowDraft>(FlowCommand.DraftAdopt, {
                        nodeId: this.initialNodeId,
                        name: draft.name || flowId,
                    });
                    this.workbench.setDraft(adopted);
                } else {
                    this.workbench.setDraft(draft);
                }
            } catch { /* not a valid flow file — ignore */ }
        }
    }

    /** Publish → fill parameters → create a session instance → open it in chat. */
    private async handleRunFlow(flowId: string, revision: number): Promise<void> {
        if (this.deps.onRunFlow) {
            this.deps.onRunFlow(flowId, revision);
            return;
        }
        const flow = await this.deps.commands.execute<{ name?: string; parameters?: FlowParameter[] } | null>(
            FlowCommand.RevisionGet, { id: flowId, revision },
        ).catch(() => null);
        const parameters = flow?.parameters ?? [];
        const values = parameters.length ? await promptFlowParameters(parameters) : {};
        if (!values) return;
        try {
            const created = await this.deps.commands.execute<{ nodeId: string }>(SessionCommand.CreateFromFlow, {
                flowId, revision, parameters: values, title: flow?.name ?? 'Workflow',
            });
            this.container?.dispatchEvent(new CustomEvent(NAVIGATION_EVENTS.NAVIGATE, {
                bubbles: true,
                composed: true,
                detail: { target: 'chat', resourceId: created.nodeId },
            }));
        } catch (error) {
            console.error('[FlowsEditor] Failed to create workflow session', error);
        }
    }

    async destroy(): Promise<void> {
        this.workbench?.destroy();
        this.workbench = undefined;
    }

    // ── IEditor no-op surface (workflows are not text documents) ──────────
    getText(): string { return ''; }
    setText(_markdown: string): void {}
    focus(): void {}
    getMode(): 'edit' | 'render' { return 'edit'; }
    async switchToMode(_mode: 'edit' | 'render'): Promise<void> {}
    setTitle(_title: string): void {}
    setReadOnly(_readOnly: boolean): void {}
    isDirty(): boolean { return false; }
    setDirty(_dirty: boolean): void {}
    readonly commands: Readonly<Record<string, Function>> = {};
    async navigateTo(): Promise<void> {}
    async search(): Promise<never[]> { return []; }
    gotoMatch(): void {}
    clearSearch(): void {}
    on(): () => void { return () => {}; }
}

function flowIdFromNodeId(nodeId: string | undefined): string | null {
    if (!nodeId) return null;
    const base = nodeId.split('/').pop() ?? '';
    if (!base.toLowerCase().endsWith('.flow')) return null;
    const id = base.slice(0, -'.flow'.length);
    return id || null;
}

export function createFlowsEditorFactory(deps: FlowsEditorDeps): EditorFactory {
    return async (container: HTMLElement, options?: EditorOptions) => {
        const editor = new FlowsEditor(deps, options?.nodeId);
        await editor.init(container);
        return editor;
    };
}
