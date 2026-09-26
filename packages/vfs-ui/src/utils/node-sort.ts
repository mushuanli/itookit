import type { VFSListSort, VFSNodeUI } from '../contracts/types';

/** A total order keeps equal names/dates stable across backend refreshes. */
export function createNodeComparator(sort: VFSListSort): (a: VFSNodeUI, b: VFSNodeUI) => number {
  const collator = new Intl.Collator(sort.locale ?? 'zh-CN', { numeric: true, sensitivity: 'base' });
  const direction = (sort.direction ?? (sort.by === 'title' ? 'asc' : 'desc')) === 'asc' ? 1 : -1;
  const date = (node: VFSNodeUI): number => Date.parse(node.metadata[sort.by as 'createdAt' | 'lastModified']) || 0;
  return (a, b) => {
    if (sort.directoriesFirst && a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    const pinned = Number(!!b.metadata.custom.isPinned) - Number(!!a.metadata.custom.isPinned);
    if (sort.pinnedFirst && pinned) return pinned;
    const primary = sort.by === 'title' ? collator.compare(a.metadata.title, b.metadata.title) : date(a) - date(b);
    if (primary) return primary * direction;
    const name = collator.compare(a.metadata.title, b.metadata.title);
    return name || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  };
}
