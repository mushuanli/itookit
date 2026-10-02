import type { VFSNodeUI, VFSUIState } from '../contracts/types';

const setKeys = ['expandedFolderIds', 'expandedOutlineIds', 'expandedOutlineH1Ids', 'selectedItemIds'] as const;

/** Copy only nodes that an action may mutate, and the paths leading to them. */
function copyPaths(items: VFSNodeUI[], ids: Set<string>): VFSNodeUI[] {
    if (!ids.size) return items;
    let changed = false;
    const copied = items.map(node => {
        const children = node.children && copyPaths(node.children, ids);
        if (!ids.has(node.id) && children === node.children) return node;
        changed = true;
        return { ...node, children: ids.has(node.id) && children ? [...children] : children };
    });
    return changed ? copied : items;
}

function targets(type: string, payload: any): string[] {
    switch (type) {
        case 'ITEM_METADATA_UPDATE': case 'ITEM_UPDATE_SUCCESS': return [payload.itemId];
        case 'NODE_PRESENTATION_UPDATE': return [payload.nodeId];
        case 'ITEM_RENAME_SUCCESS': return [payload.oldId];
        case 'FOLDER_CHILDREN_LOADED': return [payload.parentPath];
        case 'SESSION_CREATE_SUCCESS': case 'FOLDER_CREATE_SUCCESS': return [payload.id, payload.metadata.parentPath];
        case 'ITEMS_BATCH_UPDATE_SUCCESS': return payload.updates?.map((entry: any) => entry.itemId) ?? [];
        default: return [];
    }
}

export function prepareState(state: VFSUIState, type: string, payload: any): VFSUIState {
    const draft = { ...state };
    for (const key of setKeys) draft[key] = new Set(state[key]);
    draft.items = copyPaths(state.items, new Set(targets(type, payload)));
    if (type === 'SESSION_CREATE_SUCCESS' || type === 'FOLDER_CREATE_SUCCESS') draft.items = [...draft.items];
    if (type === 'SETTINGS_UPDATE') draft.uiSettings = { ...state.uiSettings };
    return draft;
}

function sameFields(left: object, right: object): boolean {
    const before = left as Record<string, unknown>, after = right as Record<string, unknown>;
    const keys = Object.keys(before);
    return keys.length === Object.keys(after).length && keys.every(key => Object.is(before[key], after[key]));
}

/** Reuse unchanged branches, including copied paths whose target was absent. */
function shareNodes(previous: VFSNodeUI[], next: VFSNodeUI[]): VFSNodeUI[] {
    if (previous === next) return previous;
    const shared = next.map((node, index) => {
        const old = previous[index];
        if (!old || node === old || node.id !== old.id) return node;
        if (old.children && node.children) {
            const children = shareNodes(old.children, node.children);
            if (children !== node.children) node = { ...node, children };
        }
        return sameFields(old, node) ? old : node;
    });
    return shared.length === previous.length && shared.every((node, index) => node === previous[index]) ? previous : shared;
}

export function finishState(previous: VFSUIState, next: VFSUIState): VFSUIState {
    for (const key of setKeys) {
        const before = previous[key], after = [...next[key]];
        if (before.size === after.length && [...before].every((id, index) => id === after[index])) next[key] = before;
    }
    if (sameFields(previous.uiSettings, next.uiSettings)) next.uiSettings = previous.uiSettings;
    next.items = shareNodes(previous.items, next.items);
    return sameFields(previous, next) ? previous : next;
}
