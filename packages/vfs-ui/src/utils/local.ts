export { escapeHTML } from './html';
export { buildRenamedFilename, formatDefaultFileTitle } from './filename';
export { t } from './i18n';
export { ACTION_ICONS, FILE_ICONS, FILE_BROWSER_ICONS, VFS_TOOLBAR_ICONS, fileTypeIcon } from './icons';
export type { Heading, TaskCounts } from '../contracts/types';

export function generateShortUUID(): string { return globalThis.crypto?.randomUUID?.().replaceAll('-', '').slice(0, 12) ?? Array.from({ length: 12 }, () => Math.floor(Math.random() * 16).toString(16)).join(''); }
export async function traceBoot<T>(_label: string, work: () => Promise<T>): Promise<T> { return work(); }
export function debounce<T extends unknown[]>(work: (...args: T) => unknown, delay: number) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = (...args: T) => { clearTimeout(timer); timer = setTimeout(() => work(...args), delay); };
    run.cancel = () => clearTimeout(timer);
    return run;
}
