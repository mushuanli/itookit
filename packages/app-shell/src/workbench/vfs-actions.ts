import { t } from '@itookit/common';
import type { VFSUIShell } from '@itookit/vfs-ui';
import type { DirectoryBulkAction } from './directory-selection';

/** Reuses VFS menu policy, deletion confirmation and the existing move picker. */
export function directoryBulkActions(ui: VFSUIShell): DirectoryBulkAction[] {
    return (['move', 'delete'] as const).map(id => ({ id, label: t(`workbench.${id}`),
        allows: ids => ui.allowsBulkAction(id, ids), run: ids => ui.runBulkAction(id, ids) }));
}
