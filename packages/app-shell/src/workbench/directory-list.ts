import { installColumnResize } from './column-resize';
import { t, getLocale, FILE_BROWSER_ICONS, ACTION_ICONS, fileTypeIcon } from '@itookit/common';
import { decorateButton } from './controls';
import { formatFileSize } from '@itookit/vfs-ui';
import { DirectorySelection, type DirectoryBulkAction } from './directory-selection';

export interface DirectoryEntry {
    id: string; name: string; type: string; created?: string | number; modified?: string | number;
    size?: number; icon?: string; disabled?: boolean; description?: string;
}
export interface DirectoryListOptions {
    title: string; path: string; entries: DirectoryEntry[];
    open(id: string): void; parent?: () => void; refresh?: () => Promise<DirectoryEntry[]>;
    actions?: { label: string; run(): void; disabled?: boolean; icon?: string }[];
    contextMenu?: (event: MouseEvent, id: string) => void;
    favorite?: { state(id: string): boolean | undefined; toggle(id: string): Promise<void> };
    select?: (ids: string[]) => void;
    bulkActions?: DirectoryBulkAction[];
}
const refreshers = new WeakMap<HTMLElement, () => Promise<void>>();
export async function refreshDirectoryList(panel: HTMLElement): Promise<void> {
    const list = panel.matches('.workbench-directory') ? panel : panel.querySelector<HTMLElement>('.workbench-directory');
    if (list) await refreshers.get(list)?.();
}
const date = (value?: string | number) => value !== undefined && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString(getLocale()) : '—';

/** Full names wrap; creation time is available in the filename tooltip. */
export function createDirectoryList(options: DirectoryListOptions): HTMLElement {
    const panel = document.createElement('section'); panel.className = 'workbench-directory';
    const heading = document.createElement('h2'); heading.textContent = options.title;
    const header = document.createElement('div'); header.className = 'workbench-directory__heading'; header.append(heading);
    const path = document.createElement('p'); path.className = 'workbench-directory__path'; path.textContent = options.path;
    const toolbar = document.createElement('div'); toolbar.className = 'workbench-directory__toolbar';
    if (options.parent) toolbar.append(action(t('workbench.parent'), options.parent, FILE_BROWSER_ICONS.up, true));
    const fail = (error: unknown) => { const notice = document.createElement('p'); notice.setAttribute('role', 'alert'); notice.textContent = error instanceof Error ? error.message : String(error); panel.append(notice); };
    const refresh = async () => { if (options.refresh) { options.entries = await options.refresh(); render(); } };
    refreshers.set(panel, refresh);
    if (options.refresh) toolbar.append(action(t('workbench.refresh'), () => { void refresh().catch(fail); }, FILE_BROWSER_ICONS.refresh, true));
    for (const entry of options.actions ?? []) { const button = action(entry.label, entry.run, entry.icon, true); button.disabled = !!entry.disabled; toolbar.append(button); }
    const search = document.createElement('input'); search.type = 'search'; search.placeholder = t('workbench.filter'); search.setAttribute('aria-label', t('workbench.filter')); toolbar.append(search);
    const table = document.createElement('table'); table.className = 'workbench-directory__table';
    const head = table.createTHead().insertRow(), body = table.createTBody();
    let sort: keyof DirectoryEntry = 'name', ascending = true;
    const selection = options.select ? new DirectorySelection(options.select, () => render(), options.bulkActions ?? [], refresh, fail) : undefined;
    addHeaders(head, selection, key => { ascending = sort === key ? !ascending : true; sort = key; render(); });
    const render = () => renderEntries(body, options, search.value, sort, ascending, selection);
    search.oninput = render; panel.append(header, path, toolbar); if (selection) panel.append(selection.bar); panel.append(table);
    render(); return panel;
}
function addHeaders(head: HTMLTableRowElement, selection: DirectorySelection | undefined, sort: (key: keyof DirectoryEntry) => void): void {
    for (const key of ['name', 'size', 'modified', 'type'] as const) {
        const cell = document.createElement('th'); cell.scope = 'col'; cell.dataset.column = key;
        if (key === 'name' && selection) cell.append(selection.all);
        cell.append(action(t(`workbench.${key}`), () => sort(key))); installColumnResize(cell); head.append(cell);
    }
}
function action(label: string, callback: () => void, icon?: string, iconOnly = false): HTMLButtonElement {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.onclick = callback;
    return icon ? decorateButton(button, icon, label, iconOnly) : button;
}
function renderEntries(body: HTMLTableSectionElement, options: DirectoryListOptions, query: string, sort: keyof DirectoryEntry, ascending: boolean, selection?: DirectorySelection): void {
    body.replaceChildren();
    for (const cell of body.parentElement!.querySelectorAll('th')) cell.setAttribute('aria-sort', cell.dataset.column === sort ? ascending ? 'ascending' : 'descending' : 'none');
    const entries = options.entries.filter(entry => entry.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
        .sort((a, b) => compareEntries(a, b, sort, ascending));
    selection?.show(entries.filter(entry => !entry.disabled).map(entry => entry.id), options.entries.map(entry => entry.id));
    for (const entry of entries) renderEntry(body, entry, options, () => renderEntries(body, options, query, sort, ascending, selection), selection);
    if (!entries.length) { const cell = body.insertRow().insertCell(); cell.colSpan = 4; cell.textContent = t('workbench.empty'); }
}
function compareEntries(a: DirectoryEntry, b: DirectoryEntry, sort: keyof DirectoryEntry, ascending: boolean): number {
    const directoryOrder = Number(b.type === 'directory') - Number(a.type === 'directory');
    if (directoryOrder) return directoryOrder;
    let comparison: number;
    if (sort === 'size') comparison = (a.size ?? -1) - (b.size ?? -1);
    else if (sort === 'modified') comparison = (new Date(a[sort] ?? 0).getTime() || 0) - (new Date(b[sort] ?? 0).getTime() || 0);
    else comparison = String(a[sort] ?? '').localeCompare(String(b[sort] ?? ''), getLocale(), { numeric: true });
    return comparison * (ascending ? 1 : -1) || a.id.localeCompare(b.id);
}
function renderEntry(body: HTMLTableSectionElement, entry: DirectoryEntry, options: DirectoryListOptions, render: () => void, selection?: DirectorySelection): void {
        const row = body.insertRow(); row.dataset.resourceId = entry.id;
        row.classList.toggle('is-selected', !!selection?.ids.has(entry.id));
        const open = action(entry.name, () => options.open(entry.id), entry.icon ?? (entry.type === 'session' ? FILE_BROWSER_ICONS.newSession : fileTypeIcon(entry.name, entry.type === 'directory'))); open.className = 'workbench-directory__name'; open.disabled = !!entry.disabled; open.title = entryDetails(entry);
        open.querySelector('.workbench-icon')!.classList.add('file-type-icon');
        const name = row.insertCell(); name.append(open);
        if (selection) { const checkbox = selection.checkbox(entry.id, entry.name); checkbox.disabled = !!entry.disabled; name.prepend(checkbox); }
        addContextMenu(row, name, entry.id, options.contextMenu);
        addFavorite(name, entry.id, options.favorite, render);
        const size = row.insertCell(); size.textContent = formatFileSize(entry.size); size.dataset.column = 'size';
        if (entry.size !== undefined && Number.isFinite(entry.size) && entry.size >= 0) size.title = `${entry.size.toLocaleString(getLocale())} B`;
        row.insertCell().textContent = date(entry.modified);
        row.insertCell().textContent = entryType(entry);
}
function entryDetails(entry: DirectoryEntry): string {
    return [entry.name, entry.description,
        `${t('workbench.created')}: ${date(entry.created)}`,
        `${t('workbench.modified')}: ${date(entry.modified)}`,
    ].filter(Boolean).join('\n');
}
function entryType(entry: DirectoryEntry): string {
    if (entry.type === 'directory') return t('workbench.folder');
    if (entry.type === 'session') return t('workbench.session');
    return entry.name.split('.').slice(1).pop()?.toUpperCase() || t('workbench.file');
}
function addContextMenu(row: HTMLTableRowElement, name: HTMLTableCellElement, id: string, contextMenu?: DirectoryListOptions['contextMenu']): void {
    if (!contextMenu) return;
    row.oncontextmenu = event => contextMenu(event, id);
    const menu = action(t('workbench.actions'), () => {
        const bounds = menu.getBoundingClientRect(); contextMenu(new MouseEvent('contextmenu', { clientX: bounds.left, clientY: bounds.bottom }), id);
    }, FILE_BROWSER_ICONS.more, true); menu.className = 'workbench-directory__row-action'; name.append(menu);
}
function addFavorite(name: HTMLTableCellElement, id: string, favorite: DirectoryListOptions['favorite'], render: () => void): void {
    const state = favorite?.state(id); if (state === undefined || !favorite) return;
    const toggle = action(t(state ? 'workbench.unfavorite' : 'workbench.favorite'), () => {
        void favorite.toggle(id).then(render).catch(error => {
            const notice = document.createElement('span'); notice.textContent = String(error); notice.setAttribute('role', 'alert'); name.append(notice);
        });
    }, ACTION_ICONS.favorite, true); toggle.className = 'workbench-directory__row-action';
    toggle.dataset.action = 'favorite-toggle'; toggle.setAttribute('aria-pressed', String(state)); name.append(toggle);
}
