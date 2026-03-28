/**
 * Build a renamed filename by preserving the original extension.
 *
 * @param newTitle       The user-supplied new title (may or may not include the extension).
 * @param originalFilename  The current filename including extension (e.g. "notes.md").
 * @returns `{ filename }` — the new filename with the original extension preserved.
 *          `{ title }` — the bare title without any extension (for use in metadata/manifests).
 *
 * @example
 * buildRenamedFilename('new-notes', 'old-notes.md')
 * // → { filename: 'new-notes.md', title: 'new-notes' }
 *
 * buildRenamedFilename('new-notes.md', 'old-notes.md')
 * // → { filename: 'new-notes.md', title: 'new-notes' }  (extension stripped from title)
 */
export function buildRenamedFilename(
    newTitle: string,
    originalFilename: string,
): { filename: string; title: string } {
    const dotIdx = originalFilename.lastIndexOf('.');
    const ext = dotIdx > 0 ? originalFilename.slice(dotIdx) : '';
    const base = ext && newTitle.toLowerCase().endsWith(ext.toLowerCase())
        ? newTitle.slice(0, -ext.length)
        : newTitle;
    return { filename: base + ext, title: base };
}
