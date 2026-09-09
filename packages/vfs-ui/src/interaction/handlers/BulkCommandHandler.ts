// interaction/handlers/BulkCommandHandler.ts
/**
 * @file vfs-ui/interaction/handlers/BulkCommandHandler.ts
 * @desc Handles bulk operations (multi-select delete, move, tag editing).
 */
import type { CommandBus } from '../CommandBus';
import type { IStatePort, IDataOperationPort } from '../../contracts/ports';
import { describeDeleteError } from '../../utils/delete-error';
import { partitionDeletable, READ_ONLY_DELETE_MESSAGE } from '../../utils/delete-guard';

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
                // Tauri v2 replaces window.confirm() with a Promise-based dialog.
                let result: boolean | Promise<boolean> = confirm(`确定要删除 ${itemIds.length} 个项目吗?`);
                result = await Promise.resolve(result);
                if (result) {
                    const { deletable, blocked } = partitionDeletable(this.store.getState().items, itemIds);
                    if (!deletable.length) {
                        alert(READ_ONLY_DELETE_MESSAGE);
                        return;
                    }
                    if (blocked.length) console.warn('[BulkCommandHandler] Skipped read-only entries:', blocked);
                    try {
                        await this.service.deleteItems(deletable);
                    } catch (error) {
                        console.error('[BulkCommandHandler] Delete failed:', error);
                        alert(`删除失败: ${describeDeleteError(error)}`);
                    }
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
            })
        );
    }

    destroy(): void {
        this.unsubs.forEach(u => u());
    }
}
