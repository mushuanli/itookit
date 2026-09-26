import type { IStatePort, ICommandPort } from '../contracts/ports';
import type { VFSNodeUI, VFSUIState } from '../contracts/types';
import type { CommandMap } from '../contracts/commands';

/** Independent search and selection over the same canonical filesystem state. */
export class ColumnState implements IStatePort {
    private query = '';
    private lastActive?: string | null;
    private selected = new Set<string>();
    private listeners = new Set<(state: VFSUIState) => void>();
    constructor(private readonly source: IStatePort, private readonly items: (state: VFSUIState, query: string) => VFSNodeUI[],
        private readonly root: () => string | null, private readonly onSearch?: (query: string) => void, private readonly resolveActive?: (id: string | null) => string | null) {}

    getState(): VFSUIState {
        const state = this.source.getState(), items = this.items(state, this.query);
        if (state.activeId !== this.lastActive) {
            if (this.selected.size <= 1) this.selected.clear();
            this.lastActive = state.activeId;
        }
        const ids = new Set<string>();
        const collect = (nodes: VFSNodeUI[]) => { for (const node of nodes) { ids.add(node.id); collect(node.children ?? []); } };
        collect(items);
        let activeId = this.resolveActive && !this.query ? this.resolveActive(state.activeId) : state.activeId;
        while (activeId && !ids.has(activeId)) activeId = activeId.slice(0, activeId.lastIndexOf('/')) || null;
        const creating = state.creatingItem;
        return { ...state, items, activeId, searchQuery: this.query,
            selectedItemIds: new Set([...this.selected].filter(id => ids.has(id))),
            creatingItem: creating && (creating.parentPath === this.root() || ids.has(creating.parentPath!)) ? creating : null };
    }
    dispatch: IStatePort['dispatch'] = action => this.source.dispatch(action);
    onAction: IStatePort['onAction'] = listener => this.source.onAction((action) => listener(action, this.getState()));
    subscribe(listener: (state: VFSUIState) => void): () => void {
        this.listeners.add(listener);
        const unsubscribe = this.source.subscribe(() => listener(this.getState()));
        return () => { this.listeners.delete(listener); unsubscribe(); };
    }
    refresh(reset = false): void {
        if (reset) { this.query = ''; this.selected.clear(); }
        for (const listener of this.listeners) listener(this.getState());
    }
    commands(raw: ICommandPort): ICommandPort {
        return { execute: (command, payload) => {
            if (command === 'ui:updateSearch') { this.query = (payload as CommandMap['ui:updateSearch']).query; this.refresh(); this.onSearch?.(this.query); return; }
            if (command.startsWith('selection:')) { this.select(command, payload); return; }
            if (['file:create', 'file:import', 'ui:startCreating'].includes(command)) {
                const data = payload as CommandMap['file:create'];
                payload = { ...data, parentPath: data.parentPath ?? this.root() } as typeof payload;
            }
            raw.execute(command, payload);
        } };
    }
    private select(command: string, payload: unknown): void {
        const data = payload as { ids?: string[]; visibleItemIds?: string[]; mode?: string } | undefined;
        if (command === 'selection:clear') this.selected.clear();
        else if (data?.mode === 'toggle') {
            for (const id of data.ids ?? []) this.selected.has(id) ? this.selected.delete(id) : this.selected.add(id);
        } else this.selected = new Set(data?.ids ?? data?.visibleItemIds ?? []);
        this.refresh();
    }
}
