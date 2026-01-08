/**
 * @file vfs-ui/core/BaseComponent.ts
 */
import type { VFSStore } from '../stores/VFSStore';
import type { Coordinator } from './Coordinator';
import type { VFSUIState } from '../types/types';

export interface BaseComponentParams {
  container: HTMLElement;
  store: VFSStore;
  coordinator: Coordinator;
}

export abstract class BaseComponent<TState extends object> {
  protected readonly container: HTMLElement;
  protected readonly store: VFSStore;
  protected readonly coordinator: Coordinator;
  protected state: TState = {} as TState;
  private unsub: (() => void) | null = null;

  constructor({ container, store, coordinator }: BaseComponentParams) {
    this.container = container;
    this.store = store;
    this.coordinator = coordinator;
  }

  init(): void {
    this.unsub = this.store.subscribe(this.update);
    this.update(this.store.getState());
    this.bindEvents();
  }

  private update = (globalState: VFSUIState): void => {
    const newState = this.transformState(globalState);
    const changed = Object.keys(newState).some(k => 
      this.state[k as keyof TState] !== newState[k as keyof TState]
    );
    if (changed) {
      this.state = newState;
      this.render();
    }
  };

  protected abstract transformState(globalState: VFSUIState): TState;
  protected abstract render(): void;
  protected bindEvents(): void {}

  destroy(): void {
    this.unsub?.();
    this.unsub = null;
    this.container.innerHTML = '';
  }
}
