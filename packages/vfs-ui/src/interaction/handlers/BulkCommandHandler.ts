// interaction/handlers/BulkCommandHandler.ts
/**
 * @file vfs-ui/interaction/handlers/BulkCommandHandler.ts
 * @desc Handles bulk operations (multi-select delete, move, tag editing).
 */
import type { CommandBus } from '../CommandBus';
import type { IStatePort, IDataOperationPort } from '../../contracts/ports';

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
            this.commandBus.on('bulk:delete', async ({ itemIds }) => {
                if (confirm(`确定要删除 ${itemIds.length} 个项目吗?`)) {
                    await this.service.deleteItems(itemIds);
                }
            }),

            this.commandBus.on('bulk:move', ({ itemIds }) => {
                this.store.dispatch({
                    type: 'MOVE_OPERATION_START',
                    payload: { itemIds },
                });
            }),

            this.commandBus.on('move:start', ({ itemIds }) => {
                this.store.dispatch({
                    type: 'MOVE_OPERATION_START',
                    payload: { itemIds },
                });
            }),

            this.commandBus.on('move:end', () => {
                this.store.dispatch({ type: 'MOVE_OPERATION_END' });
            }),

            this.commandBus.on('file:move', async ({ itemIds, targetId }) => {
                await this.service.moveItems({ itemIds, targetId });
            })
        );
    }

    destroy(): void {
        this.unsubs.forEach(u => u());
    }
}
