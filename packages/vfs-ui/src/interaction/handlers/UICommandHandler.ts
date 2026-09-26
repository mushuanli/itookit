/**
 * @file vfs-ui/interaction/handlers/UICommandHandler.ts
 * @desc Handles pure UI state mutations (settings, search, sidebar, outlines).
 */
import type { FileCreationConfig } from '../../contracts/options';
import type { CommandBus } from '../CommandBus';
import type { IStatePort, IDataOperationPort } from '../../contracts/ports';
import { resolveWritableParent } from '../../utils/creation-guard';

export class UICommandHandler {
  private unsubs: (() => void)[] = [];
  private creationRevision = 0;

  constructor(
    private readonly commandBus: CommandBus,
    private readonly store: IStatePort,
    private readonly service?: Pick<IDataOperationPort, 'assertCanCreate'>,
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
      this.commandBus.on('ui:startCreating', async data => {
        if (!this.service) return;
        const revision = ++this.creationRevision;
        try {
          const parentPath = await resolveWritableParent(this.store, this.service, data.parentPath, this.resolveParent);
          if (revision === this.creationRevision) this.dispatch('CREATE_ITEM_START', { ...data, parentPath });
        } catch (error) { if (revision === this.creationRevision) alert((error as Error).message); }
      }),
      this.commandBus.on('ui:cancelCreating', () => {
        ++this.creationRevision;
        this.dispatch('CREATE_ITEM_END');
      }),
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
    ++this.creationRevision;
    this.unsubs.forEach(u => u());
  }
}
