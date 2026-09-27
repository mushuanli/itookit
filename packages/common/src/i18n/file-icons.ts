const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const page = '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>';
export const FILE_ICONS = {
    folder: svg('<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>'),
    file: svg(page),
    document: svg(page + '<path d="M8 13h8M8 17h6"/>'),
    code: svg(page + '<path d="m9 12-3 3 3 3m6-6 3 3-3 3"/>'),
    config: svg(page + '<path d="M8 13h8M8 18h8M10 11v4m4 1v4"/>'),
    image: svg(page + '<circle cx="9" cy="12" r="1"/><path d="m6 19 4-4 3 2 3-4 3 6"/>'),
    media: svg(page + '<path d="m10 12 6 4-6 4Z"/>'),
    archive: svg(page + '<path d="M10 3v3m0 3v3m0 3v3"/>'),
    pin: svg('<path d="m15 3 6 6-4 1-3 5-2-2-6 6m6-6-3-3 5-3Z"/>'),
} as const;

/** Filename-only classification: never reads file contents or metadata. */
export function fileTypeIcon(name: string, directory = false): string {
    if (directory) return FILE_ICONS.folder;
    const extension = name.split('.').pop()?.toLowerCase() ?? '';
    if (/^(md|mdx|markdown|txt|rst)$/.test(extension)) return FILE_ICONS.document;
    if (/^(json|yaml|yml|toml|ini|conf|lock)$/.test(extension)) return FILE_ICONS.config;
    if (/^(ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|c|cpp|h|sh|html|css|sql)$/.test(extension)) return FILE_ICONS.code;
    if (/^(png|jpe?g|gif|svg|webp|avif|ico)$/.test(extension)) return FILE_ICONS.image;
    if (/^(mp[34]|wav|ogg|webm|mov|flac)$/.test(extension)) return FILE_ICONS.media;
    if (/^(zip|gz|tar|7z|rar)$/.test(extension)) return FILE_ICONS.archive;
    return FILE_ICONS.file;
}
