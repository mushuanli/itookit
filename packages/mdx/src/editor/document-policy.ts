import { editorFilePath, type EditorOptions } from '@itookit/ui-common';

function largeDocumentReason(text: string): DocumentProfile['largeReason'] {
    if (text.length > 256 * 1024) return 'bytes';
    let lines = 1, lineStart = 0;
    for (let index = 0; index < text.length; index++) {
        if (text.charCodeAt(index) === 10) {
            if (++lines > 5_000) return 'lines';
            lineStart = index + 1;
        } else if (index - lineStart >= 10_000) return 'line-length';
    }
    return new TextEncoder().encode(text).byteLength > 256 * 1024 ? 'bytes' : undefined;
}

/** An unrecognized file is source text; explicit host format preserves domain aliases. */
export function documentFormat(options: EditorOptions): 'markdown' | 'text' {
    if (options.contentFormat) return options.contentFormat;
    const path = editorFilePath(options);
    return !path || /\.(md|markdown|mdx)$/i.test(path) ? 'markdown' : 'text';
}

export interface DocumentProfile {
    readonly format: 'markdown' | 'text';
    readonly largeReason?: 'bytes' | 'lines' | 'line-length';
    readonly initialMode: 'edit' | 'render';
    readonly enableMarkdown: boolean;
    readonly enableLineWrapping: boolean;
    readonly showSourceNotice: boolean;
}

export function isLargeDocument(text: string): boolean { return largeDocumentReason(text) !== undefined; }

/** One immutable decision per open; interactive preview remains an explicit user action. */
export function documentProfile(options: EditorOptions, text: string): DocumentProfile {
    const format = documentFormat(options), largeReason = largeDocumentReason(text);
    return Object.freeze({ format, largeReason,
        initialMode: format === 'text' || largeReason ? 'edit' : options.initialMode ?? 'edit',
        enableMarkdown: format === 'markdown' && !largeReason,
        enableLineWrapping: !largeReason,
        showSourceNotice: format === 'markdown' && !!largeReason,
    });
}
