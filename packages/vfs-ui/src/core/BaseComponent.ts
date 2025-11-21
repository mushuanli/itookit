/**
 * @file vfs-ui/core/BaseComponent.ts
 */
import type { VFSStore } from '../stores/VFSStore.js';
import type { Coordinator } from './Coordinator.js';
import type { VFSUIState } from '../types/types.js';

export interface BaseComponentParams {
    container: HTMLElement;
    store: VFSStore;
    coordinator: Coordinator;
}

export abstract class BaseComponent<TLocalState extends object> {
    protected readonly container: HTMLElement;
    protected readonly store: VFSStore;
    protected readonly coordinator: Coordinator;
    protected state: TLocalState;
    private _unsubscribe: (() => void) | null = null;

    constructor({ container, store, coordinator }: BaseComponentParams) {
        this.container = container;
        this.store = store;
        this.coordinator = coordinator;
        this.state = {} as TLocalState;
    }

    public init(): void {
        this._unsubscribe = this.store.subscribe(globalState => {
            this._updateStateAndRender(globalState);
        });
        this._updateStateAndRender(this.store.getState());
        this._bindEvents();
    }

    private _updateStateAndRender(globalState: VFSUIState): void {
        const newState = this._transformState(globalState);
        const hasChanged = Object.keys(newState).some(key => this.state[key as keyof TLocalState] !== newState[key as keyof TLocalState]);
        if (hasChanged) {
            this.state = newState;
            this.render();
        }
    }
    
    protected abstract _transformState(globalState: VFSUIState): TLocalState;
    protected abstract render(): void;
    protected _bindEvents(): void { /* Optional for subclasses */ }

    public destroy(): void {
        this._unsubscribe?.();
        this._unsubscribe = null;
        this.container.innerHTML = '';
    }
}
