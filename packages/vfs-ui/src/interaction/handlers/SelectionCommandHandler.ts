// interaction/handlers/SelectionCommandHandler.ts
/**
 * @file vfs-ui/interaction/handlers/SelectionCommandHandler.ts
 * @desc Handles item selection commands.
 */
import type { CommandBus } from '../CommandBus';
import type { IStatePort } from '../../contracts/ports';

export class SelectionCommandHandler {
  private unsubs: (() => void)[] = [];

  constructor(
    private readonly commandBus: CommandBus,
    private readonly store: IStatePort
  ) {
    this.register();
  }

  private register(): void {
    this.unsubs.push(
      this.commandBus.on('selection:update', ({ ids, mode }) => {
        this.store.dispatch({
          type: 'ITEM_SELECTION_UPDATE',
          payload: { ids, mode },
        });
      }),

      this.commandBus.on('selection:clear', () => {
        this.store.dispatch({ type: 'ITEM_SELECTION_CLEAR' });
      }),

      this.commandBus.on('selection:selectAll', ({ visibleItemIds }) => {
        this.store.dispatch({
          type: 'ITEM_SELECTION_REPLACE',
          payload: { ids: visibleItemIds },
        });
      })
    );
  }

  destroy(): void {
    this.unsubs.forEach(u => u());
  }
}
