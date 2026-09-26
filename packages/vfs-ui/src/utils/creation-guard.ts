import { t } from '@itookit/common';
import type { FileCreationConfig } from '../contracts/options';
import type { IDataOperationPort, IStatePort } from '../contracts/ports';

/** Check the selected destination before applying a host's creation redirect. */
export async function resolveWritableParent(
  store: IStatePort,
  service: Pick<IDataOperationPort, 'assertCanCreate'>,
  parentPath: string | null,
  resolveParent?: FileCreationConfig['resolveParent'],
): Promise<string | null> {
  if (store.getState().readOnly) throw new Error(t('vfs.creation.readOnly'));
  await service.assertCanCreate(parentPath);
  const resolved = resolveParent ? resolveParent(parentPath) : parentPath;
  if (resolved !== parentPath) await service.assertCanCreate(resolved);
  if (store.getState().readOnly) throw new Error(t('vfs.creation.readOnly'));
  return resolved;
}
