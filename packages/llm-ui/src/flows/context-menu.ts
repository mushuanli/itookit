import { t } from '@itookit/common';
import { Toast, type ContextMenuConfig } from '@itookit/ui-common';
import { FlowLauncher, flowIdFromNodeId, type FlowRunOptions } from './run-flow';
import { restoreFlowLibrary } from './library';

export interface FlowMenuNode { id: string; type: 'file' | 'directory'; }

/** Storage remains in the host's flows directory; UI only invokes commands. */
export function createFlowContextMenuConfig<TNode extends FlowMenuNode>(options: FlowRunOptions): ContextMenuConfig<TNode> {
    const launcher = new FlowLauncher(options);
    let restoring = false;
    return { items(node, defaults) {
        if (node.type === 'directory' && ['/', '/@flows'].includes(node.id)) return [...defaults,
            { id: 'flow:restore', label: t('flow.library.restore'), onClick: async () => {
                if (restoring) return;
                restoring = true;
                try {
                    const count = await restoreFlowLibrary(options.commands);
                    Toast.success(t('flow.library.restored', { count }));
                } catch (error) { Toast.error(String(error)); }
                finally { restoring = false; }
            } }];
        const id = node.type === 'file' ? flowIdFromNodeId(node.id) : null;
        if (!id) return defaults;
        return [...defaults, { type: 'separator' }, { id: 'flow:run', label: t('flow.launch.run'),
            onClick: async () => {
                try { await launcher.run(id); }
                catch (error) { Toast.error(error instanceof Error ? error.message : t('flow.launch.failed')); }
            } }];
    } };
}
