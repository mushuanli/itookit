/**
 * @file vfs-ui/interaction/handlers/NavigationCommandHandler.ts
 * @desc Handles navigation-related commands.
 */
import type { CommandBus } from '../CommandBus';
import type { EventBus } from '../EventBus';
import type { IStatePort } from '../../contracts/ports';

export class NavigationCommandHandler {
  private unsubs: (() => void)[] = [];
  private _wasUserAction = false;

  constructor(
    private readonly commandBus: CommandBus,
    private readonly store: IStatePort,
    private readonly eventBus: EventBus
  ) {
    this.register();
  }

  get wasUserAction(): boolean {
    const was = this._wasUserAction;
    this._wasUserAction = false;
    return was;
  }

  private register(): void {
    this.unsubs.push(
      this.commandBus.on('nav:selectSession', ({ sessionId }) => {
        this._wasUserAction = true;
// interaction/handlers/NavigationCommandHandler.ts (继续)
        this.store.dispatch({
          type: 'SESSION_SELECT',
          payload: { sessionId },
        });
      }),

      this.commandBus.on('nav:toggleFolder', ({ folderId }) => {
        this.store.dispatch({
          type: 'FOLDER_TOGGLE',
          payload: { folderId },
        });
      }),

      this.commandBus.on('nav:navigateToHeading', ({ elementId }) => {
        this.eventBus.emit('navigateToHeading', { elementId });
      })
    );
  }

  destroy(): void {
    this.unsubs.forEach(u => u());
  }
}

