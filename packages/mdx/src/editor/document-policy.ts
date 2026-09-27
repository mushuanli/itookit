import { editorFilePath, type EditorOptions } from '@itookit/ui-common';

export function isLargeDocument(text: string): boolean {
    if (text.length > 256 * 1024) return true;
    let lines = 1, lineStart = 0;
    for (let index = 0; index < text.length; index++) {
        if (text.charCodeAt(index) === 10) {
            if (++lines > 5_000) return true;
            lineStart = index + 1;
        } else if (index - lineStart >= 10_000) return true;
    }
    return new TextEncoder().encode(text).byteLength > 256 * 1024;
}

/** An unrecognized file is source text; explicit host format preserves domain aliases. */
export function documentFormat(options: EditorOptions): 'markdown' | 'text' {
    if (options.contentFormat) return options.contentFormat;
    const path = editorFilePath(options);
    return !path || /\.(md|markdown|mdx)$/i.test(path) ? 'markdown' : 'text';
}
