// @file: llm-ui/utils/editorBatchAction.ts

import { MDxController } from '../components/mdx/MDxController';

/**
 * 对一组编辑器执行批量操作
 */
export async function applyToEditors(
    editors: Iterable<MDxController>,
    action: (ctrl: MDxController) => Promise<any>
): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const ctrl of editors) {
        promises.push(
            (async () => {
                try {
                    await ctrl.waitUntilReady();
                    await action(ctrl);
                } catch (e) {
                    console.warn('[editorBatchAction] Action failed:', e);
                }
            })()
        );
    }

    await Promise.all(promises);
}

/**
 * 根据 ID 列表从 editorMap 中筛选编辑器并执行操作
 */
export async function applyToEditorsByIds(
    editorMap: Map<string, MDxController>,
    ids: string[],
    action: (ctrl: MDxController) => Promise<any>
): Promise<void> {
    const editors = ids
        .map(id => editorMap.get(id))
        .filter((c): c is MDxController => c !== undefined);

    await applyToEditors(editors, action);
}
