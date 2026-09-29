import { mutableEntryIds } from '../../utils/fixed-entry';
// interaction/handlers/BulkCommandHandler.ts
/**
 * @file vfs-ui/interaction/handlers/BulkCommandHandler.ts
 * @desc Handles bulk operations (multi-select delete, move, tag editing).
 */
import type { CommandBus } from '../CommandBus';
import type { IStatePort, IDataOperationPort } from '../../contracts/ports';
import { deleteFiles } from '../file-deletion';

export class BulkCommandHandler {
    private unsubs: (() => void)[] = [];

    constructor(
        private readonly commandBus: CommandBus,
        private readonly store: IStatePort,
        private readonly service: IDataOperationPort
    ) {
        this.register();
    }

    private register(): void {
        this.unsubs.push(
            this.commandBus.on('bulk:delete', ({ itemIds }) => deleteFiles(this.store, this.service, itemIds, true)),

            this.commandBus.on('bulk:move', ({ itemIds }) => {
                itemIds = mutableEntryIds(this.store.getState().items, itemIds);
                if (!itemIds.length) return;
                this.store.dispatch({
                    type: 'MOVE_OPERATION_START',
                    payload: { itemIds },
                });
            }),

            this.commandBus.on('move:start', ({ itemIds }) => {
                itemIds = mutableEntryIds(this.store.getState().items, itemIds);
                if (!itemIds.length) return;
                this.store.dispatch({
                    type: 'MOVE_OPERATION_START',
                    payload: { itemIds },
                });
            }),

            this.commandBus.on('move:end', () => {
                this.store.dispatch({ type: 'MOVE_OPERATION_END' });
            })
        );
    }

    destroy(): void {
        this.unsubs.forEach(u => u());
    }
}
