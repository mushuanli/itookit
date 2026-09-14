/**
 * @file vfs-ui/interaction/handlers/UICommandHandler.ts
 * @desc Handles pure UI state mutations (settings, search, sidebar, outlines).
 */
import type { FileCreationConfig } from '@itookit/ui-common';
import type { CommandBus } from '../CommandBus';
import type { IStatePort } from '../../contracts/ports';

export class UICommandHandler {
  private unsubs: (() => void)[] = [];

  constructor(
    private readonly commandBus: CommandBus,
    private readonly store: IStatePort,
    private readonly resolveParent?: FileCreationConfig['resolveParent']
  ) {
    this.register();
  }

  private dispatch(type: string, payload?: any): void {
    this.store.dispatch({ type, payload });
  }

  private register(): void {
    this.unsubs.push(
      this.commandBus.on('ui:toggleSidebar', () =>
        this.dispatch('SIDEBAR_TOGGLE')
      ),
      this.commandBus.on('ui:updateSettings', ({ settings }) =>
        this.dispatch('SETTINGS_UPDATE', { settings })
      ),
      this.commandBus.on('ui:startCreating', data =>
        this.dispatch('CREATE_ITEM_START', { ...data, parentPath: this.resolveParent ? this.resolveParent(data.parentPath) : data.parentPath })
      ),
      this.commandBus.on('ui:cancelCreating', () =>
        this.dispatch('CREATE_ITEM_END')
      ),
      this.commandBus.on('ui:updateSearch', ({ query }) =>
        this.dispatch('SEARCH_QUERY_UPDATE', { query })
      ),
      this.commandBus.on('ui:toggleOutline', ({ itemId }) =>
        this.dispatch('OUTLINE_TOGGLE', { itemId })
      ),
      this.commandBus.on('ui:toggleOutlineH1', ({ elementId }) =>
        this.dispatch('OUTLINE_H1_TOGGLE', { elementId })
      )
    );
  }

  destroy(): void {
    this.unsubs.forEach(u => u());
  }
}
