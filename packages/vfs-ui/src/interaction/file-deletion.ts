import type { IDataOperationPort, IStatePort } from '../contracts/ports';
import { partitionDeletable, READ_ONLY_DELETE_MESSAGE } from '../utils/delete-guard';
import { mutableEntryIds } from '../utils/fixed-entry';
import { describeDeleteError } from '../utils/delete-error';
import { createDeleteOperation } from './deletion';

/** Files use the same deletion pipeline as host-defined virtual groups. */
export async function deleteFiles(store: IStatePort, service: IDataOperationPort, ids: string[], bulk = false): Promise<void> {
  ids = mutableEntryIds(store.getState().items, ids);
  if (!ids.length) return;
  const remove = createDeleteOperation<string[]>({
    resolve: itemIds => {
      const { deletable, blocked } = partitionDeletable(store.getState().items, itemIds);
      if (!deletable.length) alert(READ_ONLY_DELETE_MESSAGE);
      if (blocked.length) console.warn('[Delete] Skipped read-only entries:', blocked);
      return { resources: [{ ids: deletable, remove: async paths => { await service.deleteItems(paths); return 'completed'; } }] };
    },
    confirm: bulk ? () => Promise.resolve(confirm(`确定要删除 ${ids.length} 个项目吗?`)) : undefined,
  });
  try { await remove(ids); }
  catch (error) { console.error('[Delete] Failed:', error); alert(`删除失败: ${describeDeleteError(error)}`); }
}
