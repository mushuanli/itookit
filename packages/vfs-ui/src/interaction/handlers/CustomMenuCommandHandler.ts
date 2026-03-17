// interaction/handlers/CustomMenuCommandHandler.ts
/**
 * @file vfs-ui/interaction/handlers/CustomMenuCommandHandler.ts
 * @desc Forwards custom context menu actions to public event bus.
 */
import type { CommandBus } from '../CommandBus';
import type { EventBus } from '../EventBus';

export class CustomMenuCommandHandler {
    private unsub: (() => void) | null = null;

    constructor(
        private readonly commandBus: CommandBus,
        private readonly eventBus: EventBus
    ) {
        this.unsub = this.commandBus.on('custom:menuAction', ({ action, item }) => {
            this.eventBus.emit('menuItemClicked', { actionId: action, item });
        });
    }

    destroy(): void {
        this.unsub?.();
    }
}
