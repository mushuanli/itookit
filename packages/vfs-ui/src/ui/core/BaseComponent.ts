/**
 * @file vfs-ui/ui/core/BaseComponent.ts
 * @desc Abstract base for UI components. Depends on ports, not concrete classes.
 */
import type { IStatePort, ICommandPort } from '../../contracts/ports';
import type { VFSUIState } from '../../contracts/types';

export interface BaseComponentDeps {
  container: HTMLElement;
  store: IStatePort;
  commandBus: ICommandPort;
}

export abstract class BaseComponent<TState extends object> {
  protected readonly container: HTMLElement;
  protected readonly store: IStatePort;
  protected readonly commandBus: ICommandPort;
  protected state: TState = {} as TState;
  private unsub: (() => void) | null = null;

  constructor({ container, store, commandBus }: BaseComponentDeps) {
    this.container = container;
    this.store = store;
    this.commandBus = commandBus;
  }

  init(): void {
    this.unsub = this.store.subscribe(this.update);
    this.update(this.store.getState());
    this.bindEvents();
  }

  private update = (globalState: VFSUIState): void => {
    const newState = this.transformState(globalState);
    const changed = Object.keys(newState).some(
      k => this.state[k as keyof TState] !== newState[k as keyof TState]
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
